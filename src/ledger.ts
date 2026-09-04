import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import type { LedgerEntry } from "./types.js";

const LEDGER_PATH = path.join(config.root, "ledger.json");

export async function loadLedger(): Promise<LedgerEntry[]> {
  try {
    return JSON.parse(await readFile(LEDGER_PATH, "utf8")) as LedgerEntry[];
  } catch {
    return [];
  }
}

export async function saveLedger(entries: LedgerEntry[]): Promise<void> {
  await writeFile(LEDGER_PATH, JSON.stringify(entries, null, 2));
}

export async function appendEntry(entry: LedgerEntry): Promise<void> {
  const all = await loadLedger();
  all.push(entry);
  await saveLedger(all);
}

export async function updateEntry(
  id: string,
  patch: Partial<LedgerEntry>,
): Promise<void> {
  const all = await loadLedger();
  const i = all.findIndex((e) => e.id === id);
  if (i >= 0) {
    all[i] = { ...all[i], ...patch };
    await saveLedger(all);
  }
}

/**
 * A single blended score used to rank videos.
 *
 * The YouTube Analytics *reporting* API lags ~48h, so for fresh videos
 * `avgViewPct` (retention) and `rpm` are 0 for a couple days. To learn NOW we
 * lean on the near-real-time signals the Data API gives us immediately —
 * likes + comments per view (engagement) and raw reach — and fold retention/RPM
 * in only once they actually populate. This is what lets the coach react to
 * what's landing today instead of waiting two days for every batch.
 */
export function score(e: LedgerEntry): number | null {
  const p = e.performance;
  if (!p || p.views < 30) return null; // too little data to trust

  // Engagement per 1000 views — the strongest early signal of a video that hit.
  // Comments weigh more (a comment is a much stronger action than a like).
  const engPer1k = ((p.likes + p.comments * 4) / Math.max(p.views, 1)) * 1000;
  const engagement = Math.min(engPer1k / 25, 1); // ~25 eng/1k ≈ a strong short

  const retention = p.avgViewPct / 100; // 0..1  (0 until reporting catches up)
  // Absolute watch-time held per view. This is the signal the algorithm cares
  // about most, and it REWARDS LENGTH: 87% on a 42s video (holds ~42s) beats 87%
  // on a 15s video (holds ~13s). ~30s of held attention ≈ an excellent Short.
  const watchTime = Math.min(p.avgViewSec / 30, 1); // 0..1
  const hold = retention * 0.45 + watchTime * 0.55; // watch-time quality: retention % + absolute seconds held
  const reach = Math.min(p.views / 2000, 1); // raw reach still matters — growth, not just quality
  const hasRetention = p.avgViewPct > 0;

  // BALANCED — no single factor runs the ship. Watch-time (which rewards long +
  // retained) is one useful lens, weighed evenly with engagement and reach. RPM
  // excluded until monetized (always 0, would just skew things).
  return hasRetention
    ? hold * 0.4 + engagement * 0.4 + reach * 0.2
    : engagement * 0.75 + reach * 0.25;
}
