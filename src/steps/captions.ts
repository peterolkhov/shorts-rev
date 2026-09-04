import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import type { Word } from "./tts.js";
import { config } from "../config.js";
import type { CaptionStyle } from "../types.js";

export interface Caption {
  path: string;
  start: number;
  end: number;
  chunkStart: boolean; // first word of a chunk → fire a pop SFX here
}

/**
 * Karaoke captions: 2-3 words on screen at a time, and the CURRENTLY-spoken word
 * lights up in the highlight color as the audio hits it. One transparent PNG per
 * word-state; ffmpeg overlays each in its time window. This is the flashy,
 * high-contrast caption look that stops the scroll — no drawtext/libass needed.
 */
export async function renderCaptions(
  words: Word[],
  dir: string,
  style: CaptionStyle,
): Promise<Caption[]> {
  const chunks: Word[][] = [];
  for (let i = 0; i < words.length; i += style.maxWords)
    chunks.push(words.slice(i, i + style.maxWords));

  const cues: Caption[] = [];
  let n = 0;
  for (const chunk of chunks) {
    // strip trailing sentence punctuation so captions read "IS A" not "IS. A"
    const texts = chunk.map((w) => w.text.toUpperCase().replace(/[.,;:]+$/, ""));
    for (let j = 0; j < chunk.length; j++) {
      const p = path.join(dir, `cap-${String(n++).padStart(3, "0")}.png`);
      await drawCue(texts, j, style, p);
      cues.push({ path: p, start: chunk[j].start, end: chunk[j].end, chunkStart: j === 0 });
    }
  }

  // Make the caption track GAPLESS: every moment shows a caption frame, so the
  // caption overlay layer never contains a fully-transparent frame (those encode
  // as opaque black in the concat/qtrle layer). First word holds from t=0; each
  // cue runs until the next starts; the last lingers to the end.
  if (cues.length) {
    cues[0].start = 0;
    for (let i = 0; i < cues.length - 1; i++) cues[i].end = cues[i + 1].start;
    cues[cues.length - 1].end = 10_000; // clamped to video length downstream
  }
  return cues;
}

/** Draw a full chunk with word `active` in the highlight color, others normal. */
async function drawCue(
  wordsUpper: string[],
  active: number,
  style: CaptionStyle,
  outPath: string,
): Promise<void> {
  const { width, height } = config.video;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";

  const line = wordsUpper.join(" ");
  // Fit the whole line so size is stable across the chunk's word-states.
  let font = Math.round(118 * style.fontScale);
  ctx.font = `900 ${font}px sans-serif`;
  while (ctx.measureText(line).width > width * 0.92 && font > 40) {
    font -= 6;
    ctx.font = `900 ${font}px sans-serif`;
  }
  ctx.lineWidth = font * 0.16;

  const space = ctx.measureText(" ").width;
  const widths = wordsUpper.map((w) => ctx.measureText(w).width);
  const total = widths.reduce((a, b) => a + b, 0) + space * (wordsUpper.length - 1);
  let x = (width - total) / 2;
  const cy = height * style.yFraction;

  wordsUpper.forEach((w, k) => {
    // Bold-box look: the active word sits inside a solid rounded block (à la
    // Hormozi/TikTok) instead of a thin outline — a categorically different feel.
    if (style.boxColor && k === active) {
      const padX = font * 0.16;
      const padY = font * 0.12;
      const boxX = x - padX;
      const boxY = cy - font / 2 - padY;
      const boxW = widths[k] + padX * 2;
      const boxH = font + padY * 2;
      const r = Math.min(font * 0.22, boxH / 2);
      roundRect(ctx, boxX, boxY, boxW, boxH, r);
      ctx.fillStyle = style.boxColor;
      ctx.fill();
      ctx.fillStyle = style.boxTextColor ?? style.fillColor;
      ctx.fillText(w, x, cy);
    } else {
      ctx.strokeStyle = style.strokeColor;
      ctx.strokeText(w, x, cy);
      ctx.fillStyle = k === active ? style.highlightColor : style.fillColor;
      ctx.fillText(w, x, cy);
    }
    x += widths[k] + space;
  });

  await writeFile(outPath, canvas.toBuffer("image/png"));
}

/** Rounded-rectangle path (napi-rs canvas lacks a stable roundRect). */
function roundRect(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
