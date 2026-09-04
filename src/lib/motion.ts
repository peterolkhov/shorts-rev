import { config } from "../config.js";
import { run } from "./util.js";

/**
 * Turn a still image into a moving clip via a slow Ken Burns zoom/pan. This is
 * what makes AI-image slideshows feel alive instead of static — cheap (ffmpeg,
 * free) and gives the "captivating" motion without paying for AI video.
 */
export async function imageToClip(
  imagePath: string,
  outPath: string,
  seconds: number,
  index: number,
): Promise<void> {
  const { width, height, fps } = config.video;
  const frames = Math.round(seconds * fps);
  // Upscale factor for the zoompan supersample. 1.5x is plenty to avoid shimmer
  // and renders ~2.5x faster than 2x (which could grind for minutes per clip).
  const uw = Math.round(width * 1.5);
  const uh = Math.round(height * 1.5);
  // Alternate zoom-in / zoom-out and pan direction per clip for variety.
  const zoomIn = index % 2 === 0;
  const z = zoomIn ? "min(zoom+0.0012,1.2)" : "if(lte(zoom,1.0),1.2,max(zoom-0.0012,1.0))";
  const px = index % 3 === 0 ? "iw/2-(iw/zoom/2)" : "(iw-iw/zoom)/2+sin(on/40)*30";
  const py = "(ih-ih/zoom)/2";

  await run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-nostats",
    "-loop",
    "1",
    "-i",
    imagePath,
    "-vf",
    // upscale first so zoompan doesn't shimmer, then zoompan, then fit 9:16
    `scale=${uw}:${uh}:force_original_aspect_ratio=increase,crop=${uw}:${uh},zoompan=z='${z}':x='${px}':y='${py}':d=${frames}:s=${width}x${height}:fps=${fps},setsar=1`,
    "-t",
    String(seconds),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    outPath,
  ]);
}
