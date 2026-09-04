import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { config } from "../config.js";
import type { Caption } from "./captions.js";
import type { Word } from "./tts.js";
import type { CaptionStyle } from "../types.js";

/**
 * "Featuring" flair — the MrBeast/viral attention cue. But it only means
 * something if it points at something: so instead of scattering red circles over
 * random empty footage, we draw a hand-sketched red underline UNDER THE CAPTION
 * at the exact moment a key number / $ / % is spoken. It emphasizes the real
 * payoff on screen ("$360,000", "20%") and draws NOTHING when the script has no
 * number to hit — no meaningless marks over floating space.
 */
export async function renderFlair(
  dir: string,
  words: Word[],
  caption: CaptionStyle,
  target: number,
): Promise<Caption[]> {
  const { width, height } = config.video;
  const cues: Caption[] = [];

  // A word worth emphasizing: it carries a figure the viewer should catch.
  const isKey = (t: string) => /[$£€]|\d|%/.test(t);

  const fontPx = Math.round(118 * caption.fontScale);
  const underlineY = Math.round(height * caption.yFraction + fontPx * 0.5 + 26);

  let last = -99;
  let i = 0;
  for (const w of words) {
    if (!isKey(w.text)) continue;
    if (w.start - last < 2.5) continue; // one emphasis at a time, never spammy
    if (w.start > target - 0.8) break;
    if (i >= 6) break;
    last = w.start;

    const p = path.join(dir, `flair-${String(i).padStart(2, "0")}.png`);
    const canvas = createCanvas(width, height);
    drawUnderline(canvas.getContext("2d"), width, underlineY);
    await writeFile(p, canvas.toBuffer("image/png"));

    // Pop it in just as the number is said and hold a beat after.
    cues.push({
      path: p,
      start: Math.max(0, w.start - 0.05),
      end: w.end + 0.35,
      chunkStart: false,
    });
    i++;
  }
  return cues;
}

// A slightly-wobbly double underline so it reads as hand-drawn, not clip-art.
function drawUnderline(ctx: any, width: number, y: number): void {
  const w = width * 0.54;
  const x0 = (width - w) / 2;
  ctx.strokeStyle = "#FF1E1E";
  ctx.lineCap = "round";
  ctx.lineWidth = 14;
  for (const pass of [0, 1]) {
    const dy = pass === 0 ? 0 : 7;
    const bow = pass === 0 ? -6 : 10;
    ctx.beginPath();
    ctx.moveTo(x0, y + dy);
    ctx.quadraticCurveTo(width / 2, y + dy + bow, x0 + w, y + dy);
    ctx.stroke();
  }
}
