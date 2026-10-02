import type { LedgerEntry, Performance, Playbook } from "./types.js";

/** Below this, `score()` already refuses to grade. Plateau uses the same floor. */
const MIN_VIEWS = 30;

/** Recent videos all near the same view count, with nothing ~2× the median. */
export const PLATEAU_EXPLORE_FLOOR = 0.6;

/**
 * Formats a plateau is allowed to switch ON. Pure-AI slideshow / meme formats
 * stay out — the coach treats those as slop. UGC and the raw stock treatments
 * are the pattern-break.
 */
const DIVERSIFY_FORMATS = [
  "ugc-talking-head",
  "rant-mode",
  "money-story",
  "human-real",
  "gameplay-story",
  "real-explainer",
  "finance-narration",
  "ai-brainrot",
];

export interface PlateauReport {
  plateaued: boolean;
  reason: string;
  sample: number;
  medianViews: number;
  maxViews: number;
  minViews: number;
  /** stdev / mean. Near 0 means every video landed on the same number. */
  cv: number;
  /** max / median. >= 2 means something actually broke out. */
  outlierRatio: number;
  dominantFormat?: string;
  dominantTrack?: string;
  formatCounts: Record<string, number>;
  trackCounts: Record<string, number>;
}

const round = (n: number, d: number) => {
  const p = 10 ** d;
  return Math.round(n * p) / p;
};

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.sqrt(v);
}

function mode(ids: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  let best: string | undefined;
  let n = 0;
  for (const [id, c] of counts) {
    if (c > n) {
      best = id;
      n = c;
    }
  }
  return best;
}

function countsOf(ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = (out[id] ?? 0) + 1;
  return out;
}

/** Videos recent enough to judge a plateau: uploaded, not deleted, views >= 30. */
export function plateauSample(entries: LedgerEntry[], window = 8): LedgerEntry[] {
  return entries
    .filter((e) => !e.deleted && e.performance && e.performance.views >= MIN_VIEWS)
    .slice(-window);
}

/**
 * Measurable plateau: at least 4 recent videos, nothing at ~2× the median,
 * and the spread is tight (low coefficient of variation, or every video
 * within 40% of the median).
 */
export function detectPlateau(entries: LedgerEntry[], window = 8): PlateauReport {
  const sample = plateauSample(entries, window);
  const views = sample.map((e) => e.performance!.views);
  const formats = sample.map((e) => e.params.format);
  const tracks = sample.map((e) => e.params.track);
  const formatCounts = countsOf(formats);
  const trackCounts = countsOf(tracks);
  const med = median(views);
  const max = views.length ? Math.max(...views) : 0;
  const min = views.length ? Math.min(...views) : 0;
  const mean = views.length ? views.reduce((a, b) => a + b, 0) / views.length : 0;
  const cv = mean > 0 ? stdev(views) / mean : 0;
  const outlierRatio = med > 0 ? max / med : 0;
  const base = {
    sample: sample.length,
    medianViews: med,
    maxViews: max,
    minViews: min,
    cv,
    outlierRatio,
    dominantFormat: mode(formats),
    dominantTrack: mode(tracks),
    formatCounts,
    trackCounts,
  };

  if (sample.length < 4) {
    return {
      ...base,
      plateaued: false,
      reason: `only ${sample.length} graded videos — need 4+ to call a plateau`,
    };
  }

  const noBreakout = outlierRatio < 2;
  const tight = cv <= 0.35 || (max <= med * 1.4 && min >= med * 0.6);
  const plateaued = noBreakout && tight;
  return {
    ...base,
    plateaued,
    reason: plateaued
      ? `views clustered (median ${Math.round(med)}, max/median ${outlierRatio.toFixed(2)}, cv ${cv.toFixed(2)}) — no ~2× outlier`
      : noBreakout
        ? `spread is wide (cv ${cv.toFixed(2)}) even without a 2× outlier`
        : `breakout present (max/median ${outlierRatio.toFixed(2)})`,
  };
}

function diversifyWeights(
  ids: string[],
  weights: Record<string, number>,
  counts: Record<string, number>,
  dominant: string | undefined,
): Record<string, number> {
  const next = { ...weights };
  for (const id of ids) {
    const c = counts[id] ?? 0;
    if (dominant && id === dominant && c >= 2) next[id] = Math.min(next[id] ?? 1, 0.4);
    else if (c === 0) next[id] = Math.max(next[id] ?? 1, 1.6);
    else next[id] = Math.max(next[id] ?? 1, 1.15);
  }
  return next;
}

/**
 * When the measured plateau trips, force exploration. Prompt text in the coach
 * is not enough — this rewrites exploreRate and spreads format/track weight
 * toward treatments the recent batch did not already use.
 */
export function applyLearningGuards(
  pb: Playbook,
  entries: LedgerEntry[],
): { playbook: Playbook; report: PlateauReport } {
  const report = detectPlateau(entries);
  if (!report.plateaued) return { playbook: pb, report };

  const enabledFormats = [
    ...new Set([...pb.enabledFormats, ...DIVERSIFY_FORMATS]),
  ];
  const enabledTracks = [...new Set([...pb.enabledTracks, "current-events"])];
  const exploreRate = Math.min(
    0.75,
    Math.max(pb.exploreRate, PLATEAU_EXPLORE_FLOOR),
  );
  const line =
    `Plateau response: recent views clustered (n=${report.sample}, median=${Math.round(report.medianViews)}, ` +
    `max/median=${report.outlierRatio.toFixed(2)}, cv=${report.cv.toFixed(2)}). ` +
    `exploreRate set to ${exploreRate.toFixed(2)}; weight shifted off ` +
    `"${report.dominantFormat ?? "?"}" / "${report.dominantTrack ?? "?"}" toward underused formats and tracks.`;

  const without = pb.notes.replace(/\s*Plateau response:[\s\S]*$/, "").trim();
  const notes = `${without} ${line}`.trim();

  return {
    report,
    playbook: {
      ...pb,
      exploreRate,
      enabledFormats,
      enabledTracks,
      formatWeights: diversifyWeights(
        enabledFormats,
        pb.formatWeights,
        report.formatCounts,
        report.dominantFormat,
      ),
      trackWeights: diversifyWeights(
        enabledTracks,
        pb.trackWeights,
        report.trackCounts,
        report.dominantTrack,
      ),
      notes,
    },
  };
}

/** Age-normalized views/hour, preferring the value sync already stored. */
export function viewsPerHourOf(e: LedgerEntry): number {
  const p = e.performance;
  if (!p) return 0;
  if (typeof p.viewsPerHour === "number" && Number.isFinite(p.viewsPerHour)) {
    return p.viewsPerHour;
  }
  const end = new Date(p.sampledAt).getTime();
  const start = new Date(e.createdAt).getTime();
  const ageH = Math.max((end - start) / 36e5, 0.25);
  return p.views / ageH;
}

/**
 * 0..1 early-velocity term. views/hour matters immediately; a saved ~1h
 * snapshot still counts after the video has aged and hourly rate has cooled.
 */
export function velocityTerm(e: LedgerEntry): number {
  const p = e.performance;
  if (!p) return 0;
  const velocity = Math.min(viewsPerHourOf(e) / 150, 1); // ~150 views/hour ≈ hot
  const early = p.viewsAt1h != null ? Math.min(p.viewsAt1h / 800, 1) : 0;
  return Math.max(velocity, early * 0.9);
}

/**
 * Fold live Data-API counts into the windows coach can see before retention
 * and RPM exist. 1h / 24h snapshots stick once captured.
 */
export function attachEarlySignals(
  entry: { createdAt: string; performance?: Performance },
  perf: Performance,
  now = Date.now(),
): Performance {
  const created = new Date(entry.createdAt).getTime();
  const ageHours = Math.max((now - created) / 36e5, 1 / 60);
  const viewsPerHour = perf.views / ageHours;
  const engagementRate = perf.views > 0 ? (perf.likes + perf.comments) / perf.views : 0;
  const prev = entry.performance;
  let viewsAt1h = prev?.viewsAt1h;
  let viewsAt24h = prev?.viewsAt24h;
  if (viewsAt1h == null && ageHours >= 0.45 && ageHours <= 2.5) viewsAt1h = perf.views;
  if (viewsAt24h == null && ageHours >= 18 && ageHours <= 36) viewsAt24h = perf.views;
  return {
    ...perf,
    ageHours: round(ageHours, 2),
    viewsPerHour: round(viewsPerHour, 1),
    engagementRate: round(engagementRate, 4),
    ...(viewsAt1h != null ? { viewsAt1h } : {}),
    ...(viewsAt24h != null ? { viewsAt24h } : {}),
  };
}
