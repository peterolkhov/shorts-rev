import { writeFile } from "node:fs/promises";
import path from "node:path";
import { config, requireEnv } from "../config.js";
import { log } from "../lib/util.js";

interface PexelsVideo {
  width: number;
  height: number;
  video_files: { link: string; width: number; height: number }[];
}

/**
 * Fetch one portrait clip per query. Returns local file paths in query order.
 * Pexels footage is free to use; we still keep original assets to stay
 * strike-safe (no reposting others' finished videos).
 */
export async function fetchBroll(
  queries: string[],
  dir: string,
): Promise<string[]> {
  const key = requireEnv(config.pexels.apiKey, "PEXELS_API_KEY");
  const paths: string[] = [];

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(
      q,
    )}&orientation=portrait&per_page=5&size=medium`;

    const res = await fetch(url, { headers: { Authorization: key } });
    if (!res.ok) {
      log("broll", `"${q}" search failed (${res.status}), skipping`);
      continue;
    }
    const data = (await res.json()) as { videos: PexelsVideo[] };
    const video = data.videos?.[0];
    if (!video) {
      log("broll", `no results for "${q}", skipping`);
      continue;
    }

    // Prefer a portrait-ish file around 1080 wide.
    const file =
      video.video_files
        .filter((f) => f.height >= f.width)
        .sort((a, b) => Math.abs(a.width - 1080) - Math.abs(b.width - 1080))[0] ??
      video.video_files[0];

    const clipPath = path.join(dir, `broll-${String(i).padStart(2, "0")}.mp4`);
    const bin = await (await fetch(file.link)).arrayBuffer();
    await writeFile(clipPath, Buffer.from(bin));
    paths.push(clipPath);
    log("broll", `"${q}" -> ${path.basename(clipPath)}`);
  }

  if (paths.length === 0) {
    throw new Error("No B-roll could be fetched. Check PEXELS_API_KEY / queries.");
  }
  return paths;
}
