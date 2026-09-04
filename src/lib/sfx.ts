import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { run } from "./util.js";

/**
 * Attention SFX, synthesized with ffmpeg (no asset licensing):
 *  - "pop"   → a short bright blip on each caption change (auditory interrupt)
 *  - "whoosh"→ a noise sweep on each scene cut (motion feels dynamic)
 * These are the brainrot audio cues that make a Short feel alive. Kept subtle
 * and mixed UNDER the voice so narration stays clear.
 */
async function ensureAssets(dir: string): Promise<{ pop: string; whoosh: string }> {
  const pop = path.join(dir, "sfx-pop.wav");
  const whoosh = path.join(dir, "sfx-whoosh.wav");

  // Volume scales with intensity — "subtle" is much quieter + softer than the
  // old cues (this is what kills the constant "beeping").
  const full = config.audio.sfxIntensity === "full";
  const popVol = full ? 0.4 : 0.16;
  const whooshVol = full ? 0.28 : 0.13;

  if (!existsSync(pop)) {
    await run("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "sine=frequency=784:duration=0.09",
      "-af", `afade=t=in:d=0.01,afade=t=out:st=0.02:d=0.07,volume=${popVol}`, pop,
    ]);
  }
  if (!existsSync(whoosh)) {
    await run("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "anoisesrc=d=0.35:c=pink:a=0.4",
      "-af", `highpass=f=200,lowpass=f=4000,afade=t=in:d=0.05,afade=t=out:st=0.15:d=0.2,volume=${whooshVol}`,
      whoosh,
    ]);
  }
  return { pop, whoosh };
}

/**
 * Build a single audio track = voice + a pop at each caption start + a whoosh at
 * each scene cut. Returns the path to the mixed audio (falls back to the raw
 * voice if SFX are disabled).
 */
export async function mixAudio(
  voicePath: string,
  captionStarts: number[],
  cutTimes: number[],
  dir: string,
  outPath: string,
): Promise<string> {
  if (!config.audio.sfx) return voicePath;

  const { pop, whoosh } = await ensureAssets(dir);
  // In "subtle" mode, fire a pop only every 3rd caption chunk (a soft accent,
  // not a beep on every 2 words) and a whoosh only every 2nd cut. "full" keeps
  // one on every event (the old behavior).
  const subtle = config.audio.sfxIntensity !== "full";
  const pops = (subtle ? captionStarts.filter((_, i) => i % 3 === 0) : captionStarts).slice(0, 40);
  const allCuts = cutTimes.filter((t) => t > 0.2);
  const cuts = (subtle ? allCuts.filter((_, i) => i % 2 === 0) : allCuts).slice(0, 40);

  // Reuse each SFX input via asplit, delay each copy to its event time, amix all.
  const parts: string[] = [];
  const mixLabels: string[] = ["0:a"]; // voice

  if (pops.length) {
    parts.push(`[1:a]asplit=${pops.length}${pops.map((_, i) => `[p${i}]`).join("")}`);
    pops.forEach((t, i) => {
      parts.push(`[p${i}]adelay=${Math.round(t * 1000)}:all=1[pd${i}]`);
      mixLabels.push(`pd${i}`);
    });
  }
  if (cuts.length) {
    parts.push(`[2:a]asplit=${cuts.length}${cuts.map((_, i) => `[w${i}]`).join("")}`);
    cuts.forEach((t, i) => {
      parts.push(`[w${i}]adelay=${Math.round(t * 1000)}:all=1[wd${i}]`);
      mixLabels.push(`wd${i}`);
    });
  }
  parts.push(
    `${mixLabels.map((l) => `[${l}]`).join("")}amix=inputs=${mixLabels.length}:normalize=0:dropout_transition=0[aout]`,
  );

  await run("ffmpeg", [
    "-y", "-i", voicePath, "-i", pop, "-i", whoosh,
    "-filter_complex", parts.join(";"),
    "-map", "[aout]", "-c:a", "pcm_s16le", outPath,
  ]);
  return outPath;
}
