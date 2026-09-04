import { generateObject } from "ai";
import { z } from "zod";
import { config, resolveModel } from "./config.js";
import { loadLedger, score } from "./ledger.js";
import { loadPlaybook, savePlaybook } from "./playbook.js";
import { STRATEGY_RULES } from "./strategy.js";
import { log } from "./lib/util.js";

const PlaybookSchema = z.object({
  hookGuidance: z.string(),
  replicate: z
    .string()
    .describe(
      "The single best-performing video's WINNING FORMULA, written so the writer can clone it: quote its hook opener near-verbatim as a template to lightly reword, plus its format id and topic angle. If NOTHING has clearly broken out (roughly >=2x the pack), set this to 'no clear outlier yet — keep exploring'.",
    ),
  voice: z.object({
    stability: z.number().min(0).max(1),
    style: z.number().min(0).max(1),
    speed: z.number().min(0.8).max(1.2),
  }),
  caption: z.object({
    maxWords: z.number().int().min(1).max(4),
    fillColor: z.string(),
    highlightColor: z.string(),
    strokeColor: z.string(),
    yFraction: z.number().min(0.45).max(0.82),
    fontScale: z.number().min(0.8).max(1.3),
  }),
  visual: z.object({
    mode: z.enum(["stock", "gameplay", "mixed"]),
    segmentSeconds: z.number().min(1.8).max(4.5),
  }),
  targetLengthSec: z.number().min(28).max(58),
  exploreRate: z.number().min(0.05).max(0.75),
  enabledFormats: z
    .array(z.string())
    .describe("format ids to keep testing — drop consistent losers, but keep >=2 for diversity"),
  formatWeights: z
    .record(z.string(), z.number())
    .describe("relative pick weight per format id — raise winners, lower losers"),
  enabledTracks: z
    .array(z.string())
    .describe("content tracks to keep running (e.g. finance, entertainment) — keep >=1"),
  trackWeights: z
    .record(z.string(), z.number())
    .describe("relative pick weight per track — balance high-RPM (finance) vs high-reach (entertainment)"),
  notes: z.string(),
});

/**
 * The self-improvement step. Summarize graded videos, hand the coach the winners
 * vs losers, and let it move the playbook toward what retains + earns. Params
 * that lack data are left near current values; exploreRate shrinks as evidence
 * accumulates.
 */
export async function coach(): Promise<void> {
  const ledger = await loadLedger();
  const pb = await loadPlaybook();

  const graded = ledger
    .map((e) => ({ e, s: score(e) }))
    .filter((x): x is { e: (typeof ledger)[number]; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s);

  if (graded.length < 3) {
    log(
      "coach",
      `only ${graded.length} videos have enough data — need ~3+. Keeping playbook. Post more, run sync, retry.`,
    );
    return;
  }

  const summarize = (x: (typeof graded)[number]) => {
    const p = x.e.performance!;
    return {
      score: Number(x.s.toFixed(3)),
      postHour: new Date(x.e.createdAt).getHours(), // 0-23 local — for spotting time-of-day effects
      track: x.e.params.track,
      format: x.e.params.format,
      topic: x.e.params.topic,
      hook: x.e.hook,
      views: p.views,
      likes: p.likes,
      comments: p.comments,
      engagementPer1k: Number((((p.likes + p.comments * 4) / Math.max(p.views, 1)) * 1000).toFixed(1)),
      retentionPct: Math.round(p.avgViewPct), // 0 until reporting API catches up (~48h)
      watchSec: Math.round(p.avgViewSec), // absolute seconds held per view — retention × length, the watch-time signal
      rpm: Number(p.rpm.toFixed(3)),
      exploredDimension: x.e.exploredDimension ?? "none",
      voice: x.e.params.voice,
      caption: { y: x.e.params.caption.yFraction, maxWords: x.e.params.caption.maxWords },
      visual: x.e.params.visual,
      lengthSec: x.e.params.targetLengthSec,
    };
  };

  const winners = graded.slice(0, Math.min(5, graded.length)).map(summarize);
  const losers = graded.slice(-Math.min(5, graded.length)).map(summarize);

  log("coach", `analyzing ${graded.length} graded videos`);

  const { object } = await generateObject({
    model: resolveModel(),
    schema: PlaybookSchema,
    prompt: `You are the optimization coach for a faceless YouTube Shorts channel that runs TWO content tracks:
finance (high RPM, earns per view) and entertainment (low RPM, high reach — grows subscribers).
Your job: move the playbook toward what RETAINS viewers and grows the channel, using the evidence below.

Non-negotiable strategy (never violate):
${STRATEGY_RULES}

Current playbook:
${JSON.stringify(pb, null, 2)}

IMPORTANT — retentionPct and rpm are 0 for recent videos because YouTube's
reporting API lags ~48h. For those, judge by engagementPer1k (likes+comments per
1000 views) and views — that's the real, current signal of what landed. Lean on it.

TOP performers (highest blended score — engagement-led while retention data lags):
${JSON.stringify(winners, null, 2)}

WORST performers:
${JSON.stringify(losers, null, 2)}

🎨 VISUAL QUALITY / BRAND (hard rule): the pure-AI-IMAGE formats — ai-slideshow, meme-chaos, rapid-list, ai-cinematic — produce visible AI SLOP (garbled sign/poster text, uncanny distorted scenes) that makes the channel look fake and kills subscriber conversion. Do NOT re-enable those, even if one spikes on raw views. Real footage over AI images, always. (NOTE: 'ai-brainrot' is fine — despite the name it now uses REAL stock footage, keeping the pop-culture chaos energy without the slop; keep it enabled.)

🚨 PLATEAU RESPONSE — READ FIRST. Look at the spread of recent views. If videos are CLUSTERING around the same count with no breakouts (e.g. everything ~1,000 or everything stuck low), the channel is PLATEAUED — viewers are bored of whatever has BECOME the default look. When that happens, do NOT play it safe or make tiny tweaks. Go AGGRESSIVE: push exploreRate UP (toward 0.5–0.7) and shift weight toward the most UNCONVENTIONAL, pattern-breaking treatments currently available — bolder captions, different voices, faster cuts, unusual visual grades. IMPORTANT — these are ROTATING TRIALS, never a permanent identity: whatever style has been running the MOST is now the thing to break AWAY from, so keep cycling which treatments you push (don't just re-favor the same experiments every time), retire any treatment that's had a fair shot (>=3 videos) and clearly flopped, and always keep at least one fresh, unusual experiment in the mix. Only ease off toward exploitation once something is CLEARLY and repeatedly beating baseline (multiples of it) — and even then hold back a slice for new experiments so the channel never goes static again.

Rules for your update (apply AFTER the plateau check above):
- If NOT plateaued (a clear winner is emerging), move CONSERVATIVELY toward what winners share. Don't overfit to one video.
- TRACKS: adjust trackWeights by what's working. Value entertainment for RETENTION + reach even though its RPM is low — it grows subs toward the monetization threshold. Value finance for RPM. Keep BOTH enabled unless one is clearly and repeatedly failing on retention.
- FORMATS: raise formatWeights for formats that retain best; lower losers. Keep enabledFormats >= 2 for diversity — don't kill a format with < ~3 videos of data.
- Set voice/caption/visual/length toward the winners' values, but only shift a knob if the evidence points one way.
- If an explored dimension clearly helped, adopt it; if it hurt, move the opposite way.
- exploreRate: if a clear winner is emerging, lower it as evidence accumulates (keep >= 0.05); if PLATEAUED (see above), raise it toward 0.5–0.7 to force pattern-breaks.
- WATCH-TIME is a useful lens, not the only one: watchSec (absolute seconds held = retention × length) is worth noting — high retention on a LONGER video (a 42s video holding 87% ≈ 42 watch-sec) is a genuinely strong result and a signal a format/structure is working. Factor it in, but BALANCE it against engagement and reach — don't over-index on it, and don't force videos longer chasing watch-seconds. Only adjust targetLengthSec if the evidence is clear and consistent; otherwise leave length alone.
- TIME OF DAY: postHour is when each video went out (0–23). We're deliberately drifting post times to learn if timing matters. If a posting hour clearly and repeatedly outperforms, mention it in notes so we can lean into it — but don't over-read a couple of data points.
- REPLICATE THE OUTLIER (this is how we EXPLOIT a hit, per the "find your repeatable outlier and repeat it" principle): find the single best performer — ideally one doing ~2x the others. In \`replicate\`, capture its exact winning formula so the writer makes MORE like it — quote its hook opener near-verbatim (a template to reword 2-3 words of), name its format and topic angle. Only when a video clearly beats the pack. If none does yet, set \`replicate\` to "no clear outlier yet — keep exploring" so we don't prematurely lock onto noise.
- hookGuidance: concrete, learned, general instruction for hooks based on what hooked viewers.
- notes: one paragraph explaining what you changed and why.

Return the full updated playbook.`,
  });

  await savePlaybook({ ...object, updatedAt: new Date().toISOString() });
  log("coach", `playbook updated. ${object.notes}`);
}
