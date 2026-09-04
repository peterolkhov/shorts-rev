import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { log, slug } from "./lib/util.js";
import { loadPlaybook, draw } from "./playbook.js";
import { appendEntry, updateEntry, loadLedger } from "./ledger.js";
import { getFormat } from "./formats.js";
import { FOOTAGE_FILTERS } from "./styles.js";
import { getTrack } from "./tracks.js";
import { assertReady, estimateCost } from "./preflight.js";
import { fetchVisualsByProvider } from "./providers.js";
import { imageToClip } from "./lib/motion.js";
import { ideate, type Script } from "./steps/ideate.js";
import { tts } from "./steps/tts.js";
import { renderCaptions } from "./steps/captions.js";
import { renderFlair } from "./steps/flair.js";
import { assemble } from "./steps/assemble.js";
import { upload } from "./steps/upload.js";
import { publishAll } from "./publishers/index.js";
import { syncAnalytics } from "./steps/analytics.js";
import { coach } from "./coach.js";
import type { VideoParams, CaptionStyle } from "./types.js";

export interface MadeVideo {
  id: string;
  videoPath: string;
  script: Script;
  params: VideoParams;
  dir: string;
}

export interface MakeOpts {
  track?: string; // force a content track (else bandit picks)
  format?: string; // force a format (else bandit picks)
  script?: Script; // render THIS pre-made script (skip ideate) — e.g. an approved one
  ideatePrompt?: string; // the prompt that produced opts.script (for the record)
  voiceId?: string; // override the ElevenLabs voice (for style samples)
  caption?: Partial<CaptionStyle>; // override caption look (for style samples)
  visualStyle?: string; // override the AI-image art direction (rotate the look)
  mascot?: boolean; // splice a Matteo (Italian-brainrot mascot) cameo into the b-roll
}

/** Generate one finished .mp4 using playbook-drawn params, logged to the ledger. */
export async function make(seed?: string, opts: MakeOpts = {}): Promise<MadeVideo> {
  const pb = await loadPlaybook();
  const { params, exploring, dimension } = draw(pb);
  if (opts.track) params.track = opts.track;
  if (opts.format) {
    params.format = opts.format;
    const f = getFormat(opts.format);
    params.caption = { ...pb.caption, ...f.caption };
    params.visual.segmentSeconds = f.clipSeconds;
  }
  if (opts.caption) params.caption = { ...params.caption, ...opts.caption }; // style sample
  const format = getFormat(params.format);
  const track = getTrack(params.track);
  assertReady(format); // fail before any paid call if a key is missing
  log(
    "pipeline",
    `${track.label} × ${format.label} | ~$${estimateCost(format).toFixed(2)}/video${
      exploring ? ` | exploring: ${dimension}` : ""
    }`,
  );

  // Use an approved pre-made script if given; else write one. Feed recent topics
  // in so the writer can't recycle an angle it just used.
  let script: Script;
  let ideatePrompt: string;
  if (opts.script) {
    script = opts.script;
    ideatePrompt = opts.ideatePrompt ?? "(pre-made script supplied to make())";
  } else {
    const ledger = await loadLedger();
    const recentTopics = ledger
      .slice(-15)
      .map((e) => e.params?.topic || e.title)
      .filter(Boolean);
    ({ script, prompt: ideatePrompt } = await ideate(
      pb,
      track,
      params.targetLengthSec,
      format.scriptDirective,
      seed,
      recentTopics,
    ));
  }
  params.topic = script.topic;

  const name = slug(script.topic) || "short";
  const id = `${Date.now()}-${name}`;
  const dir = path.join(config.workDir, id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "script.json"), JSON.stringify(script, null, 2));

  // Full, reproducible record of HOW this video was generated — the exact prompt
  // plus every knob (track, format, provider, voice, captions, pacing, seed).
  const generation = {
    id,
    createdAt: new Date().toISOString(),
    seed: seed ?? null,
    exploring,
    exploredDimension: dimension,
    track: { id: track.id, label: track.label },
    format: {
      id: format.id,
      label: format.label,
      provider: format.provider,
      clipSeconds: format.clipSeconds,
      visualPromptStyle: format.visualPromptStyle,
    },
    model: config.model,
    voiceId: opts.voiceId ?? config.elevenlabs.voiceId,
    visualStyle: opts.visualStyle ?? format.visualPromptStyle,
    sfxIntensity: config.audio.sfxIntensity,
    params,
    brollQueries: script.brollQueries,
    ideatePrompt,
  };
  await writeFile(path.join(dir, "generation.json"), JSON.stringify(generation, null, 2));

  // Follow CTA: append a short rotating subscribe line to the voiceover so it's
  // BOTH spoken and auto-captioned at the very end — aimed at the subscriber
  // conversion bottleneck. Rotated so it's not identical every video; FOLLOW_CTA=0 disables.
  const FOLLOW_CTAS = [
    "Follow for the money games nobody taught you.",
    "Follow if you want the stuff your bank hopes you skip.",
    "Follow for one money truth a day.",
    "Follow so the next one finds you.",
  ];
  const followCta =
    process.env.FOLLOW_CTA === "0"
      ? ""
      : " " + FOLLOW_CTAS[Math.floor(Math.random() * FOLLOW_CTAS.length)];

  const audioPath = path.join(dir, "voice.mp3");
  const { words } = await tts(
    `${script.hook} ${script.narration}${followCta}`,
    audioPath,
    params.voice,
    opts.voiceId,
  );

  const captions = await renderCaptions(words, dir, params.caption);
  const broll = await fetchVisualsByProvider(format.provider, {
    queries: script.brollQueries,
    topic: script.topic,
    promptStyle: opts.visualStyle ?? format.visualPromptStyle,
    clipSeconds: params.visual.segmentSeconds,
    dir,
  });

  // Comedic mascot cameo: splice a Matteo (Italian-brainrot) slide into the
  // middle of the b-roll so he randomly appears mid-explainer — committing to the
  // finance-brainrot bit. Non-sequitur is the joke.
  if (opts.mascot) {
    const matteoSrc = path.join(config.root, "assets", "matteo.jpg");
    if (existsSync(matteoSrc)) {
      const matteoClip = path.join(dir, "matteo-cameo.mp4");
      await imageToClip(matteoSrc, matteoClip, params.visual.segmentSeconds, 1);
      const at = Math.max(1, Math.floor(broll.length / 2));
      broll.splice(at, 0, matteoClip);
      log("pipeline", "🇮🇹 Matteo cameo spliced in");
    }
  }

  const audioDur = words.at(-1)?.end ?? 40;
  const flair = config.video.flair
    ? await renderFlair(dir, words, params.caption, audioDur)
    : [];

  await mkdir(config.outDir, { recursive: true });
  const videoPath = path.join(config.outDir, `${name}-${Date.now()}.mp4`);
  const footageFilter = FOOTAGE_FILTERS[format.footageFilter ?? "none"] ?? "";
  await assemble(dir, broll, audioPath, captions, flair, videoPath, params.visual.segmentSeconds, footageFilter);

  await appendEntry({
    id,
    createdAt: new Date().toISOString(),
    videoPath,
    exploring,
    exploredDimension: dimension,
    title: script.title,
    hook: script.hook,
    params,
  });

  log("done", videoPath);
  return { id, videoPath, script, params, dir };
}

/** Generate one and upload it, recording the YouTube id for later analytics. */
export async function makeAndUpload(seed?: string): Promise<string> {
  const { id, videoPath, script } = await make(seed);
  const url = await upload(videoPath, script);
  const ytId = url.split("/").pop();
  if (ytId) await updateEntry(id, { youtubeId: ytId });
  return url;
}

/**
 * Upload every already-rendered video in the ledger that hasn't been posted yet
 * (reads each video's saved script.json for title/description/tags). Lets us
 * post the videos we already made without regenerating.
 */
export async function post(
  privacy: "private" | "unlisted" | "public" = config.youtube.privacy,
): Promise<string[]> {
  const ledger = await loadLedger();
  const pending = ledger.filter((e) => !e.youtubeId && existsSync(e.videoPath));
  if (!pending.length) {
    log("post", "nothing to post — all ledger videos are already uploaded.");
    return [];
  }

  const urls: string[] = [];
  for (const e of pending) {
    const scriptPath = path.join(config.workDir, e.id, "script.json");
    if (!existsSync(scriptPath)) {
      log("post", `skip ${e.id}: no script.json`);
      continue;
    }
    const script = JSON.parse(await readFile(scriptPath, "utf8")) as Script;
    const url = await upload(e.videoPath, script, privacy);
    const ytId = url.split("/").pop();
    if (ytId) await updateEntry(e.id, { youtubeId: ytId });
    urls.push(url);
  }
  return urls;
}

/**
 * Fan every already-rendered, not-yet-crossposted ledger video out to all the
 * platforms in PLATFORMS (YouTube + TikTok + Instagram + Facebook). Reads each
 * video's saved script.json. A video counts as "done" once it has a YouTube id;
 * unconfigured platforms are skipped, so this is safe to re-run.
 */
export async function crosspost(
  privacy: "private" | "unlisted" | "public" = config.youtube.privacy,
): Promise<void> {
  const ledger = await loadLedger();
  // Anything not yet on YouTube is our proxy for "unposted"; already-crossposted
  // platforms self-skip via their stored ids at the entry level if you extend it.
  const pending = ledger.filter((e) => !e.youtubeId && existsSync(e.videoPath));
  if (!pending.length) {
    log("crosspost", "nothing pending — all ledger videos already posted.");
    return;
  }
  for (const e of pending) {
    const scriptPath = path.join(config.workDir, e.id, "script.json");
    if (!existsSync(scriptPath)) {
      log("crosspost", `skip ${e.id}: no script.json`);
      continue;
    }
    const script = JSON.parse(await readFile(scriptPath, "utf8")) as Script;
    log("crosspost", `→ ${script.title}`);
    await publishAll(e.id, e.videoPath, script, privacy);
  }
}

/**
 * One full autonomous cycle: learn from what's live, then produce + post one
 * video per lane. The bandit varies length / captions / voice / hook / visual
 * style within each, so every cycle is also an experiment. Per-slot try/catch so
 * one failure never sinks the whole run.
 *
 * Slots: finance + entertainment + hottakes let the bandit pick the format
 * (stock vs AI images — the media-vs-AI experiment); the 4th is always a brainrot
 * (AI-image, chaotic) so that style is represented every cycle.
 */
const CYCLE_PLAN: MakeOpts[] = [
  { track: "finance" },
  { track: "entertainment" },
  { track: "hottakes" },
  { track: "entertainment", format: "ai-brainrot" },
];

export async function cycle(
  privacy: "private" | "unlisted" | "public" = "public",
): Promise<string[]> {
  // 1. learn from live performance (both tolerate no-data / no-auth gracefully)
  await syncAnalytics().catch((e) => log("cycle", `analytics skipped: ${e.message}`));
  await coach().catch((e) => log("cycle", `coach skipped: ${e.message}`));

  // 2. produce + fan each out to every configured platform
  const urls: string[] = [];
  for (const slot of CYCLE_PLAN) {
    try {
      const { id, videoPath, script } = await make(undefined, slot);
      const results = await publishAll(id, videoPath, script, privacy);
      const posted = results.filter((r) => r.status === "posted" || r.status === "draft");
      posted.forEach((r) => r.url && urls.push(r.url));
      const lane = `${slot.track}${slot.format ? "/" + slot.format : ""}`;
      log("cycle", `[${lane}] ${posted.length}/${results.length} platforms ok`);
    } catch (e: any) {
      log("cycle", `slot [${slot.track}] failed: ${e.message}`);
    }
  }
  log("cycle", `done — ${CYCLE_PLAN.length} videos across ${config.platforms.length} platforms (${privacy})`);
  return urls;
}

/** Generate N videos (no upload) — good for reviewing before you post. */
export async function batch(count: number): Promise<MadeVideo[]> {
  const out: MadeVideo[] = [];
  for (let i = 0; i < count; i++) {
    log("batch", `video ${i + 1}/${count}`);
    out.push(await make());
  }
  return out;
}
