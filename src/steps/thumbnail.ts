import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

/**
 * A clickable, MrBeast-style custom thumbnail: a striking background image, a
 * dark gradient for text legibility, and 2-4 words of HUGE bold text with a
 * red-highlighted keyword. 1280x720 (YouTube standard). Set via the Data API
 * after upload (needs a phone-verified channel).
 */
export async function renderThumbnail(
  bgImagePath: string,
  words: string[], // 2-4 punchy words; last one gets the red pop
  outPath: string,
): Promise<string> {
  const W = 1280;
  const H = 720;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background image, cover-fit.
  try {
    const img = await loadImage(bgImagePath);
    const scale = Math.max(W / img.width, H / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } catch {
    ctx.fillStyle = "#0b1e13";
    ctx.fillRect(0, 0, W, H);
  }

  // Dark bottom gradient so text reads.
  const g = ctx.createLinearGradient(0, H * 0.35, 0, H);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.85)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Big bold text, wrapped to <=2 lines, red pop on the last word.
  const lines = wrap(words, 2);
  let font = 150;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fits = (f: number) => {
    ctx.font = `900 ${f}px sans-serif`;
    return lines.every((ln) => ctx.measureText(ln.join(" ")).width < W - 100);
  };
  while (font > 60 && !fits(font)) font -= 6;
  ctx.font = `900 ${font}px sans-serif`;
  ctx.lineJoin = "round";

  const lineH = font * 1.05;
  const startY = H - 60 - (lines.length - 1) * lineH - lineH / 2;
  const lastWord = words[words.length - 1].toUpperCase();
  lines.forEach((ln, i) => {
    const text = ln.join(" ").toUpperCase();
    const y = startY + i * lineH;
    // stroke
    ctx.strokeStyle = "rgba(0,0,0,0.95)";
    ctx.lineWidth = font * 0.14;
    ctx.strokeText(text, W / 2, y);
    // fill — red if this line is the last word, else white
    ctx.fillStyle = text === lastWord ? "#FF2D2D" : "#FFFFFF";
    ctx.fillText(text, W / 2, y);
  });

  await writeFile(outPath, canvas.toBuffer("image/png"));
  return outPath;
}

/** Greedy-wrap words into at most `maxLines` lines. */
function wrap(words: string[], maxLines: number): string[][] {
  if (words.length <= 2) return [words];
  const perLine = Math.ceil(words.length / maxLines);
  const lines: string[][] = [];
  for (let i = 0; i < words.length; i += perLine) lines.push(words.slice(i, i + perLine));
  return lines;
}

export function thumbPath(dir: string): string {
  return path.join(dir, "thumbnail.png");
}
