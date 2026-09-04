import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import { config } from "../config.js";
import { log } from "../lib/util.js";
import { authedClient, upload, deleteVideos } from "./upload.js";
import { loadLedger, updateEntry } from "../ledger.js";
import type { Script } from "./ideate.js";

// Tunables. Two ways to qualify as dead:
//  1. established flop — had a full day and basically nobody watched.
//  2. dead on arrival — a couple hours in and still ~zero views, meaning it never
//     got an algorithmic push (its neighbors did). Cheaper to pull + retry fresh.
const MIN_AGE_HOURS = 24; // established: a full day to prove itself
const DEAD_VIEW_MAX = 20; // <= this many views after MIN_AGE_HOURS = dead
const DOA_AGE_HOURS = 3; // dead-on-arrival: a couple hours in
const DOA_VIEW_MAX = 2; // and still essentially zero views
const MAX_TAKEDOWNS = 2; // per tick — clear deadweight faster at low volume
const QUEUE_CAP = 12; // backpressure: stop taking down if the repost queue is this deep
const MAX_REPOSTS = 1; // recycle a topic at most this many times, then let it rest
const REPOST_WAIT_MIN = 90; // a queued repost must wait this long (=> a LATER tick, ticks are ~5h apart)
const MAX_QUEUE_AGE_DAYS = 5; // drop queued reposts older than this — don't revive stale topics

interface QueueItem {
  topic: string;
  track: string;
  repostCount: number; // the count to stamp on the reposted video
  queuedAt: string; // ISO — used to enforce "repost at a later tick"
  oldViews: number;
  oldTitle: string;
}

const QUEUE_PATH = path.join(config.root, "repost-queue.json");

async function loadQueue(): Promise<QueueItem[]> {
  try {
    return JSON.parse(await readFile(QUEUE_PATH, "utf8")) as QueueItem[];
  } catch {
    return [];
  }
}
async function saveQueue(q: QueueItem[]): Promise<void> {
  await writeFile(QUEUE_PATH, JSON.stringify(q, null, 2));
}

/** Live view counts + publish times for a set of video ids (batched, 50/call). */
async function fetchStats(
  ids: string[],
): Promise<Record<string, { views: number; publishedAt: string }>> {
  const yt = google.youtube({ version: "v3", auth: await authedClient() });
  const out: Record<string, { views: number; publishedAt: string }> = {};
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const res = await yt.videos.list({ part: ["statistics", "snippet"], id: batch });
    for (const v of res.data.items ?? []) {
      out[v.id!] = {
        views: Number(v.statistics?.viewCount ?? 0),
        publishedAt: v.snippet?.publishedAt ?? "",
      };
    }
  }
  return out;
}

/**
 * Take down up to MAX_TAKEDOWNS genuinely-dead videos (established flops OR
 * dead-on-arrival), worst first, queueing each topic to be reposted on a later
 * tick. Backpressure: won't take down past QUEUE_CAP pending reposts. Returns how
 * many it took down. Set dryRun to only report what it WOULD do.
 */
export async function recycleTakedown(dryRun = false): Promise<number> {
  const ledger = await loadLedger();
  const cands = ledger.filter(
    (e) => e.youtubeId && !e.deleted && (e.repostCount ?? 0) < MAX_REPOSTS,
  );
  if (!cands.length) return 0;

  const stats = await fetchStats(cands.map((e) => e.youtubeId!));
  const now = Date.now();
  const dead = cands
    .map((e) => {
      const s = stats[e.youtubeId!] ?? { views: 0, publishedAt: "" };
      const ageH = s.publishedAt ? (now - new Date(s.publishedAt).getTime()) / 3.6e6 : 0;
      return { e, views: s.views, publishedAt: s.publishedAt, ageH };
    })
    .filter(
      (x) =>
        x.publishedAt &&
        ((x.ageH >= MIN_AGE_HOURS && x.views <= DEAD_VIEW_MAX) || // established flop
          (x.ageH >= DOA_AGE_HOURS && x.views <= DOA_VIEW_MAX)), // dead on arrival
    )
    .sort((a, b) => a.views - b.views || b.ageH - a.ageH); // fewest views, then oldest

  if (!dead.length) {
    log("recycle", "no dead videos to take down (none old enough + under the view floor)");
    return 0;
  }

  const queue = await loadQueue();
  const batch = dead.slice(0, MAX_TAKEDOWNS); // always prune deadweight, up to the cap
  let queueRoom = Math.max(0, QUEUE_CAP - queue.length); // but only requeue while there's room

  let done = 0;
  for (const t of batch) {
    const tag = t.ageH < MIN_AGE_HOURS ? "DOA" : "flop";
    const willQueue = queueRoom > 0;
    if (dryRun) {
      log("recycle", `[dry] take down ${t.e.youtubeId} (${t.views}v, ${t.ageH.toFixed(1)}h, ${tag})${willQueue ? " → requeue" : " → delete only (queue full)"}: ${t.e.title?.slice(0, 44)}`);
      if (willQueue) queueRoom--;
      done++;
      continue;
    }
    await deleteVideos([t.e.youtubeId!]);
    await updateEntry(t.e.id, { deleted: true });
    if (willQueue) {
      queue.push({
        topic: t.e.params?.topic || t.e.title || "",
        track: t.e.params?.track || "finance",
        repostCount: (t.e.repostCount ?? 0) + 1,
        queuedAt: new Date().toISOString(),
        oldViews: t.views,
        oldTitle: t.e.title ?? "",
      });
      queueRoom--;
      log("recycle", `took down "${t.e.title?.slice(0, 42)}" (${t.views}v, ${t.ageH.toFixed(1)}h, ${tag}) → queued for repost`);
    } else {
      log("recycle", `took down "${t.e.title?.slice(0, 42)}" (${t.views}v, ${t.ageH.toFixed(1)}h, ${tag}) → deleted (queue full, no repost)`);
    }
    done++;
  }
  if (!dryRun) await saveQueue(queue);
  return done;
}

/**
 * If a queued item has waited long enough (=> queued on an earlier tick), rebuild
 * it fresh through the CURRENT (evolving) pipeline and repost it. Returns the new
 * URL or null if nothing is due. `make` is injected to avoid an import cycle.
 */
export async function repostDue(
  make: (seed: string, opts: { track: string }) => Promise<{ id: string; videoPath: string }>,
): Promise<string | null> {
  let queue = await loadQueue();
  const now = Date.now();
  // Drop stale queued topics first — a flop from a week ago isn't worth reviving.
  const before = queue.length;
  queue = queue.filter((q) => (now - new Date(q.queuedAt).getTime()) / 8.64e7 < MAX_QUEUE_AGE_DAYS);
  if (queue.length !== before) {
    await saveQueue(queue);
    log("recycle", `expired ${before - queue.length} stale queued repost(s)`);
  }
  const idx = queue.findIndex(
    (q) => (now - new Date(q.queuedAt).getTime()) / 60000 >= REPOST_WAIT_MIN,
  );
  if (idx < 0) return null;

  const item = queue[idx];
  const r = await make(item.topic, { track: item.track });
  const scriptPath = path.join(config.workDir, r.id, "script.json");
  if (!existsSync(scriptPath)) return null;
  const script = JSON.parse(await readFile(scriptPath, "utf8")) as Script;
  const url = await upload(r.videoPath, script, "public");
  const ytId = url.split("/").pop();
  if (ytId) await updateEntry(r.id, { youtubeId: ytId, repostCount: item.repostCount });

  queue.splice(idx, 1);
  await saveQueue(queue);
  log("recycle", `reposted "${item.oldTitle.slice(0, 40)}" (was ${item.oldViews} views) → ${url}`);
  return url;
}
