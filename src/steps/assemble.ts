import { writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { ffprobeDuration, log, run } from "../lib/util.js";
import { mixAudio } from "../lib/sfx.js";
import type { Caption } from "./captions.js";

/**
 * Compose the final 1080x1920 Short:
 *  1. Normalize every B-roll clip to identical params (so concat can copy).
 *  2. Loop the clips in order until they cover the narration length.
 *  3. Overlay caption PNGs on a timeline (no drawtext/libass needed).
 *  4. Mux the voiceover.
 */
export async function assemble(
  videoDir: string,
  brollPaths: string[],
  audioPath: string,
  captions: Caption[],
  flair: Caption[],
  outPath: string,
  segmentSeconds: number = config.video.segmentSeconds,
  footageFilter: string = "", // optional ffmpeg grade/LUT fragment applied to every clip
): Promise<void> {
  const { width, height, fps } = config.video;
  const audioDur = await ffprobeDuration(audioPath);
  const target = audioDur + 0.3;

  // 1. normalize each clip to identical codec/params (+ optional signature grade)
  const grade = footageFilter.trim() ? `,${footageFilter.trim()}` : "";
  const normalized: { file: string; dur: number }[] = [];
  for (let i = 0; i < brollPaths.length; i++) {
    const out = path.join(videoDir, `norm-${String(i).padStart(2, "0")}.mp4`);
    await run("ffmpeg", [
      "-y", "-i", brollPaths[i], "-t", String(segmentSeconds), "-an",
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1${grade}`,
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", out,
    ]);
    normalized.push({ file: out, dur: await ffprobeDuration(out) });
  }
  log("assemble", `normalized ${normalized.length} clips`);

  // 2. loop clips until they cover the narration, recording each cut time
  const order: string[] = [];
  const cutTimes: number[] = [];
  let acc = 0;
  for (let i = 0; acc < target && i < 500; i++) {
    const clip = normalized[i % normalized.length];
    cutTimes.push(acc); // scene cut lands here → whoosh
    order.push(clip.file);
    acc += clip.dur;
  }
  const listFile = path.join(videoDir, "concat.txt");
  await writeFile(
    listFile,
    order.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"),
  );

  const silent = path.join(videoDir, "silent.mp4");
  await run("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listFile,
    "-t", String(target), "-c", "copy", silent,
  ]);
  log("assemble", `stitched ${order.length} segments -> ${target.toFixed(1)}s`);

  // 3. build the audio: voice + pop on each caption chunk + whoosh on each cut
  const mixedAudio = await mixAudio(
    audioPath,
    captions.filter((c) => c.chunkStart).map((c) => c.start),
    cutTimes,
    videoDir,
    path.join(videoDir, "mixed.wav"),
  );
  log("assemble", `audio mixed (${config.audio.sfx ? "SFX on" : "SFX off"})`);

  // 4. Compose overlays. Captions are many (~100+) so they go through ONE
  // gapless concat layer (fast). Flair is sparse (~7) so each cue is overlaid
  // DIRECTLY with an enable window — this avoids the concat/qtrle bug where long
  // fully-transparent runs encode as opaque black (which blacked out the video).
  const captionLayer = captions.length
    ? await buildLayer(captions, target, videoDir, "captions")
    : null;

  const inputs: string[] = ["-i", silent, "-i", mixedAudio];
  let lastV = "0:v";
  const parts: string[] = [];
  let idx = 2;

  if (captionLayer) {
    inputs.push("-i", captionLayer);
    parts.push(`[${lastV}][${idx}:v]overlay=0:0[c]`);
    lastV = "c";
    idx++;
  }
  flair.forEach((f, i) => {
    inputs.push("-loop", "1", "-i", f.path);
    const out = i === flair.length - 1 ? "vout" : `f${i}`;
    parts.push(
      `[${lastV}][${idx}:v]overlay=0:0:enable='between(t,${f.start.toFixed(2)},${f.end.toFixed(2)})'[${out}]`,
    );
    lastV = out;
    idx++;
  });
  const hasOverlay = parts.length > 0;
  if (hasOverlay && lastV !== "vout") {
    // rename the last label to vout
    parts[parts.length - 1] = parts[parts.length - 1].replace(`[${lastV}]`, "[vout]");
  }
  const filter = hasOverlay ? parts.join(";") : null;

  await run("ffmpeg", [
    "-y", ...inputs,
    ...(filter ? ["-filter_complex", filter, "-map", "[vout]"] : ["-map", "0:v"]),
    "-map", "1:a:0",
    "-t", String(target),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k", "-pix_fmt", "yuv420p", "-r", String(fps),
    outPath,
  ]);
  log("assemble", `rendered ${path.basename(outPath)}`);
}

/**
 * Build a single full-length transparent caption video (qtrle/alpha) by
 * concatenating each cue's PNG for its duration, with a transparent frame in the
 * gaps. Returns the .mov path. This is what lets the final render use ONE
 * overlay for all karaoke words.
 */
async function buildLayer(
  cues: Caption[],
  target: number,
  dir: string,
  tag: string,
): Promise<string> {
  const { width, height, fps } = config.video;

  // a fully-transparent frame for the gaps
  const blank = path.join(dir, `${tag}-blank.png`);
  await run("ffmpeg", [
    "-y", "-f", "lavfi", "-i", `color=c=black@0.0:s=${width}x${height}`,
    "-frames:v", "1", "-pix_fmt", "rgba", blank,
  ]);

  // walk the timeline: transparent filler, then each cue, then filler to end
  const segs: { file: string; dur: number }[] = [];
  let t = 0;
  for (const c of cues) {
    if (c.start > t + 0.01) segs.push({ file: blank, dur: c.start - t });
    const end = Math.min(c.end, target);
    if (end > c.start) segs.push({ file: c.path, dur: end - c.start });
    t = end;
  }
  if (target > t + 0.01) segs.push({ file: blank, dur: target - t });

  const list = segs
    .map((s) => `file '${s.file.replace(/'/g, "'\\''")}'\nduration ${s.dur.toFixed(3)}`)
    .join("\n");
  const listFile = path.join(dir, `${tag}-concat.txt`);
  // concat demuxer needs the final file repeated to flush its duration
  await writeFile(listFile, `${list}\nfile '${segs.at(-1)!.file}'\n`);

  const layer = path.join(dir, `${tag}.mov`);
  await run("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", listFile,
    "-vf", `fps=${fps},format=rgba`,
    "-c:v", "qtrle", "-t", String(target), layer,
  ]);
  return layer;
}
