import { writeFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { config, requireEnv } from "./config.js";
import { log } from "./lib/util.js";
import { falRun } from "./lib/fal.js";
import { imageToClip } from "./lib/motion.js";
import { fetchBroll } from "./steps/broll.js";

export type Provider =
  | "stock" // Pexels
  | "pixabay-gameplay" // royalty-free gameplay loop
  | "ai-image" // fal image + ken-burns motion
  | "ai-video" // fal text-to-video
  | "real-image" // REAL photos (Wikimedia Commons) + ken-burns, stock fallback
  | "local-gameplay"; // your own ./gameplay files

export interface VisualRequest {
  queries: string[]; // visual beats from the script
  topic: string;
  promptStyle: string; // format-specific look (e.g. "cinematic", "chaotic meme")
  clipSeconds: number;
  dir: string;
}

/** Resolve the visual clips for a video according to the chosen provider. */
export async function fetchVisualsByProvider(
  provider: Provider,
  req: VisualRequest,
): Promise<string[]> {
  switch (provider) {
    case "stock":
      return fetchBroll(req.queries, req.dir);
    case "pixabay-gameplay":
      return pixabayGameplay(req.queries.length, req.dir);
    case "ai-image":
      return aiImageClips(req);
    case "ai-video":
      return aiVideoClips(req);
    case "real-image":
      return realImageClips(req);
    case "local-gameplay":
      return localGameplay(req.queries.length);
  }
}

async function download(url: string, dest: string): Promise<string> {
  const bin = await (await fetch(url)).arrayBuffer();
  await writeFile(dest, Buffer.from(bin));
  return dest;
}

// ─── Pixabay royalty-free gameplay/satisfying backgrounds ──────────────
async function pixabayGameplay(count: number, dir: string): Promise<string[]> {
  const key = requireEnv(config.pixabay.apiKey, "PIXABAY_API_KEY");
  const terms = ["gameplay", "minecraft parkour", "satisfying", "abstract loop"];
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const q = terms[i % terms.length];
    const url = `https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(
      q,
    )}&per_page=20&safesearch=true`;
    const res = await fetch(url);
    if (!res.ok) {
      log("pixabay", `"${q}" ${res.status}, skipping`);
      continue;
    }
    const data = (await res.json()) as {
      hits: { videos: { large?: { url: string }; medium?: { url: string } } }[];
    };
    const hit = data.hits[i % Math.max(data.hits.length, 1)];
    const file = hit?.videos?.large?.url ?? hit?.videos?.medium?.url;
    if (!file) continue;
    paths.push(
      await download(file, path.join(dir, `gp-${String(i).padStart(2, "0")}.mp4`)),
    );
    log("pixabay", `"${q}" -> clip ${i}`);
  }
  if (!paths.length) throw new Error("Pixabay returned no gameplay clips.");
  return paths;
}

// ─── fal AI images → Ken Burns motion clips ────────────────────────────
async function aiImageClips(req: VisualRequest): Promise<string[]> {
  const paths: string[] = [];
  const queries = req.queries.slice(0, config.fal.maxImages); // hard cost cap
  for (let i = 0; i < queries.length; i++) {
    const prompt = `photorealistic photograph, ${req.promptStyle}, vertical 9:16, ${queries[i]}, related to ${req.topic}, ultra detailed. ABSOLUTELY NO text, no words, no letters, no signs, no typography, no watermark — clean real photo only.`;
    log("ai-image", `beat ${i + 1}/${queries.length} generating…`);
    const out = await falRun(config.fal.imageModel, {
      prompt,
      image_size: "portrait_16_9",
      num_images: 1,
    });
    const imgUrl = out?.images?.[0]?.url ?? out?.image?.url;
    if (!imgUrl) {
      log("ai-image", `no image for beat ${i}, skipping`);
      continue;
    }
    const img = await download(imgUrl, path.join(req.dir, `img-${i}.png`));
    const clip = path.join(req.dir, `aimg-${String(i).padStart(2, "0")}.mp4`);
    await imageToClip(img, clip, req.clipSeconds, i);
    paths.push(clip);
    log("ai-image", `beat ${i} rendered`);
  }
  if (!paths.length) throw new Error("No AI images generated (check FAL_KEY/model).");
  return paths;
}

// ─── fal text-to-video ─────────────────────────────────────────────────
async function aiVideoClips(req: VisualRequest): Promise<string[]> {
  const paths: string[] = [];
  const queries = req.queries.slice(0, config.fal.maxVideos); // hard cost cap (expensive!)
  for (let i = 0; i < queries.length; i++) {
    const prompt = `${req.promptStyle}, ${queries[i]}, related to ${req.topic}`;
    const out = await falRun(config.fal.videoModel, {
      prompt,
      aspect_ratio: "9:16",
      resolution: "720p",
    });
    const vidUrl = out?.video?.url ?? out?.videos?.[0]?.url;
    if (!vidUrl) {
      log("ai-video", `no video for beat ${i}, skipping`);
      continue;
    }
    paths.push(
      await download(vidUrl, path.join(req.dir, `aivid-${String(i).padStart(2, "0")}.mp4`)),
    );
    log("ai-video", `beat ${i} generated`);
  }
  if (!paths.length) throw new Error("No AI video generated (check FAL_KEY/model).");
  return paths;
}

// ─── REAL photos from Wikimedia Commons (free, license-safe) ───────────
// For beats that name a real person/company/place (e.g. "Warren Buffett",
// "JPMorgan headquarters") we fetch an ACTUAL photo from Wikimedia Commons and
// Ken-Burns it into a clip. Beats with no good real photo fall back to Pexels
// stock, so the video is real recognizable imagery where it matters and clean
// stock elsewhere — never a wall of random AI. No API key needed for Wikimedia.
const WIKI_UA = "shorts-rev/0.1 (faceless-shorts pipeline)";

async function wikimediaImage(
  query: string,
  dir: string,
  i: number,
): Promise<string | null> {
  const api =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
    `&generator=search&gsrsearch=${encodeURIComponent("filetype:bitmap " + query)}` +
    `&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=1200`;
  let data: any;
  try {
    const res = await fetch(api, { headers: { "User-Agent": WIKI_UA } });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }
  const pages: any[] = data?.query?.pages ? Object.values(data.query.pages) : [];
  pages.sort((a, b) => (a.index ?? 99) - (b.index ?? 99)); // preserve search relevance
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info || !/image\/(jpeg|png)/.test(info.mime ?? "")) continue;
    // ONLY the scaled thumbnail (iiurlwidth=1200) — never the raw original,
    // which can be a 100MB+ file that makes ffmpeg spew/hang on decode.
    const url: string | undefined = info.thumburl;
    if (!url) continue;
    // Skip pathologically tall/wide images (multi-page document scans, banners):
    // the Ken-Burns cover-scale on a 1200x9000 image can grind for minutes.
    const tw = Number(info.thumbwidth ?? 0);
    const th = Number(info.thumbheight ?? 0);
    if (tw && th) {
      const ar = th / tw;
      if (ar > 2.2 || ar < 0.35 || th > 3200) continue; // fall through to next result
    }
    const ext = info.mime.includes("png") ? "png" : "jpg";
    try {
      return await download(url, path.join(dir, `wiki-${String(i).padStart(2, "0")}.${ext}`));
    } catch {
      continue;
    }
  }
  return null;
}

/** Does the beat name a real person/org/place worth an ACTUAL photo? */
function namesRealEntity(q: string): boolean {
  return (
    /\b[A-Z][a-z]+ [A-Z][a-z]+/.test(q) || // two capitalized words = a name
    /\b(Buffett|Bezos|Musk|Dimon|Zuckerberg|Gates|Cuban|Powell|Trump|Biden|JPMorgan|Berkshire|Amazon|Apple|Tesla|Google|Microsoft|Nvidia|Meta|Netflix|Walmart|Federal Reserve|Wall Street|IRS|Nasdaq|White House|Capitol|Congress)\b/i.test(q)
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One relevant AI image (fal) → Ken-Burns clip. Returns null on failure. */
async function aiImageClip(req: VisualRequest, query: string, i: number): Promise<string | null> {
  const style = req.promptStyle || "clean editorial finance illustration, rich color, cinematic lighting";
  const prompt = `photorealistic photograph, ${style}, vertical 9:16, ${query}, in the context of ${req.topic}, ultra detailed, natural lighting. ABSOLUTELY NO text, no words, no letters, no signs, no posters, no typography, no captions, no numbers, no logos, no watermark — a clean real-looking photo only.`;
  // fal intermittently 403s ("exhausted balance") under burst even with balance —
  // retry with backoff so a transient blip doesn't drop the beat to stock junk.
  let out: any;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      out = await falRun(config.fal.imageModel, {
        prompt,
        image_size: "portrait_16_9",
        num_images: 1,
      });
      break;
    } catch (e: any) {
      if (attempt === 3) throw e;
      await sleep(1200 * (attempt + 1)); // 1.2s, 2.4s, 3.6s
    }
  }
  const imgUrl = out?.images?.[0]?.url ?? out?.image?.url;
  if (!imgUrl) return null;
  const img = await download(imgUrl, path.join(req.dir, `aimg-${String(i).padStart(2, "0")}.png`));
  const clip = path.join(req.dir, `real-${String(i).padStart(2, "0")}.mp4`);
  await imageToClip(img, clip, req.clipSeconds, i);
  return clip;
}

/**
 * Hybrid visuals so EVERY beat is on-topic:
 *  - names a real person/org/place → real Wikimedia photo (accurate face/logo)
 *  - abstract concept → a RELEVANT fal AI image (a rising chart, cash, etc.)
 *  - both fail → one stock clip, uniquely named (no more broll-00 collisions)
 * This replaces the old "random Wikimedia/stock" that returned pianos and
 * microscope scans for finance beats.
 */
async function realImageClips(req: VisualRequest): Promise<string[]> {
  const queries = req.queries.slice(0, 8);
  const paths: string[] = [];
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    let clip: string | null = null;

    if (namesRealEntity(q)) {
      const img = await wikimediaImage(q, req.dir, i);
      if (img) {
        clip = path.join(req.dir, `real-${String(i).padStart(2, "0")}.mp4`);
        await imageToClip(img, clip, req.clipSeconds, i);
        log("real-image", `"${q}" -> real photo (Wikimedia)`);
      }
    }

    if (!clip && config.fal.apiKey) {
      try {
        clip = await aiImageClip(req, q, i);
        if (clip) log("real-image", `"${q}" -> AI image`);
      } catch (e: any) {
        log("real-image", `"${q}" AI image failed (${e.message})`);
      }
    }

    if (!clip) {
      try {
        const stock = await fetchBroll([q], req.dir); // writes broll-00.mp4
        if (stock.length) {
          const uniq = path.join(req.dir, `stock-${String(i).padStart(2, "0")}.mp4`);
          await rename(stock[0], uniq); // avoid the broll-00 collision across beats
          clip = uniq;
          log("real-image", `"${q}" -> stock`);
        }
      } catch (e: any) {
        log("real-image", `"${q}" skipped (${e.message})`);
      }
    }

    if (clip) paths.push(clip);
  }
  if (!paths.length) throw new Error("real-image: no visuals found for any beat.");
  return paths;
}

// ─── your own gameplay folder ──────────────────────────────────────────
async function localGameplay(count: number): Promise<string[]> {
  let files: string[] = [];
  try {
    files = (await readdir(config.gameplayDir))
      .filter((f) => /\.(mp4|mov|webm|mkv)$/i.test(f))
      .map((f) => path.join(config.gameplayDir, f));
  } catch {
    /* no folder */
  }
  if (!files.length) throw new Error("No clips in ./gameplay for local-gameplay.");
  return Array.from({ length: count }, (_, i) => files[i % files.length]);
}
