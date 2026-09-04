import { google } from "googleapis";
import { authedClient } from "./upload.js";
import { loadLedger, updateEntry } from "../ledger.js";
import { log } from "../lib/util.js";
import type { Performance } from "../types.js";

/**
 * Pull per-video metrics from the YouTube Analytics API and fold them into the
 * ledger. Retention (averageViewPercentage) is meaningful immediately; revenue
 * only appears once the channel is in the Partner Program.
 */
export async function syncAnalytics(): Promise<void> {
  const auth = await authedClient();
  const yta = google.youtubeAnalytics({ version: "v2", auth });
  const yt = google.youtube({ version: "v3", auth });

  const ledger = await loadLedger();
  const pending = ledger.filter((e) => e.youtubeId);
  if (pending.length === 0) {
    log("analytics", "no uploaded videos to sync yet");
    return;
  }

  // Near-real-time public counts from the Data API. The Analytics *reporting*
  // API lags ~48h, so for fresh videos it returns 0 — the Data API is the only
  // way to see today's views. Batch up to 50 ids per call.
  const liveStats = new Map<string, { views: number; likes: number; comments: number }>();
  const ids = pending.map((e) => e.youtubeId!);
  for (let i = 0; i < ids.length; i += 50) {
    const res = await yt.videos.list({ part: ["statistics"], id: ids.slice(i, i + 50) });
    for (const v of res.data.items ?? []) {
      liveStats.set(v.id!, {
        views: Number(v.statistics?.viewCount ?? 0),
        likes: Number(v.statistics?.likeCount ?? 0),
        comments: Number(v.statistics?.commentCount ?? 0),
      });
    }
  }

  // Revenue metrics require monetization; request them but tolerate failure.
  const withRevenue =
    "views,averageViewPercentage,averageViewDuration,likes,comments,estimatedRevenue";
  const noRevenue =
    "views,averageViewPercentage,averageViewDuration,likes,comments";

  for (const entry of pending) {
    // Retention/revenue from the reporting API (may be 0 until it processes).
    const perf =
      (await queryVideo(yta, entry.youtubeId!, withRevenue).catch(() =>
        queryVideo(yta, entry.youtubeId!, noRevenue),
      )) ?? emptyPerf();

    // Overlay live counts — these are truthy immediately, so views/likes/RPM
    // reflect reality now instead of waiting for the reporting lag.
    const live = liveStats.get(entry.youtubeId!);
    if (live) {
      perf.views = Math.max(perf.views, live.views);
      perf.likes = Math.max(perf.likes, live.likes);
      perf.comments = Math.max(perf.comments, live.comments);
      perf.rpm = perf.views > 0 ? (perf.estRevenue / perf.views) * 1000 : 0;
    }

    await updateEntry(entry.id, { performance: perf });
    log(
      "analytics",
      `${entry.youtubeId}: ${perf.views} views, ${perf.avgViewPct.toFixed(
        0,
      )}% retention, $${perf.rpm.toFixed(3)} RPM`,
    );
  }
}

function emptyPerf(): Performance {
  return {
    views: 0,
    avgViewPct: 0,
    avgViewSec: 0,
    likes: 0,
    comments: 0,
    estRevenue: 0,
    rpm: 0,
    sampledAt: new Date().toISOString(),
  };
}

async function queryVideo(
  yta: ReturnType<typeof google.youtubeAnalytics>,
  videoId: string,
  metrics: string,
): Promise<Performance | null> {
  const res = await yta.reports.query({
    ids: "channel==MINE",
    startDate: "2020-01-01",
    endDate: new Date().toISOString().slice(0, 10),
    metrics,
    filters: `video==${videoId}`,
  });

  const headers = (res.data.columnHeaders ?? []).map((h) => h.name!);
  const row = res.data.rows?.[0];
  if (!row) return null;

  const get = (name: string): number => {
    const i = headers.indexOf(name);
    return i >= 0 ? Number(row[i]) || 0 : 0;
  };

  const views = get("views");
  const estRevenue = get("estimatedRevenue");
  return {
    views,
    avgViewPct: get("averageViewPercentage"),
    avgViewSec: get("averageViewDuration"),
    likes: get("likes"),
    comments: get("comments"),
    estRevenue,
    rpm: views > 0 ? (estRevenue / views) * 1000 : 0,
    sampledAt: new Date().toISOString(),
  };
}
