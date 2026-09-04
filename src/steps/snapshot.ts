import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";
import { config } from "../config.js";
import { log } from "../lib/util.js";
import { authedClient } from "./upload.js";

export interface MonSnapshot {
  date: string; // YYYY-MM-DD (local)
  subs: number;
  totalViews: number;
  views90: number; // valid public views, trailing 90d (reporting lags ~48h)
  watchHours: number; // trailing 12mo
  videoCount: number;
}

const SNAP_PATH = path.join(config.root, "monetization-snapshots.json");

export async function loadSnapshots(): Promise<MonSnapshot[]> {
  try {
    return JSON.parse(await readFile(SNAP_PATH, "utf8")) as MonSnapshot[];
  } catch {
    return [];
  }
}

/**
 * Pull the current monetization metrics and append them as a dated point to
 * monetization-snapshots.json (one point per day — re-running same day updates
 * it). Builds the historical progression Peter wants to chart over time.
 */
export async function recordSnapshot(): Promise<MonSnapshot> {
  const auth = await authedClient();
  const yt = google.youtube({ version: "v3", auth });
  const ya = google.youtubeAnalytics({ version: "v2", auth });

  const ch = await yt.channels.list({ part: ["statistics"], mine: true });
  const s = ch.data.items![0].statistics!;

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 90);
  let views90 = 0;
  let watchHours = 0;
  try {
    const r = await ya.reports.query({
      ids: "channel==MINE",
      startDate: fmt(start),
      endDate: fmt(today),
      metrics: "views,estimatedMinutesWatched",
    });
    if (r.data.rows?.[0]) {
      views90 = Number(r.data.rows[0][0]) || 0;
      watchHours = Math.round(((Number(r.data.rows[0][1]) || 0) / 60) * 10) / 10;
    }
  } catch (e: any) {
    log("snapshot", `analytics query failed: ${String(e.message).slice(0, 60)}`);
  }

  const snap: MonSnapshot = {
    date: today.toLocaleDateString("en-CA"), // YYYY-MM-DD local
    subs: Number(s.subscriberCount) || 0,
    totalViews: Number(s.viewCount) || 0,
    views90,
    watchHours,
    videoCount: Number(s.videoCount) || 0,
  };

  const snaps = await loadSnapshots();
  const i = snaps.findIndex((x) => x.date === snap.date);
  if (i >= 0) snaps[i] = snap;
  else snaps.push(snap);
  snaps.sort((a, b) => a.date.localeCompare(b.date));
  await writeFile(SNAP_PATH, JSON.stringify(snaps, null, 2));
  log("snapshot", `${snap.date}: ${snap.subs} subs, ${snap.totalViews} total views, ${snap.views90} views/90d, ${snap.watchHours}h (${snaps.length} points)`);
  return snap;
}
