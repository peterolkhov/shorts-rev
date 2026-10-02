import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { config, requireEnv } from "../config.js";
import { log } from "../lib/util.js";
import { falRun, falUpload } from "../lib/fal.js";
import { imageToClip } from "../lib/motion.js";
import {
  getActiveInfluencer,
  portraitCachePath,
  rememberFace,
  type Influencer,
} from "../influencers.js";
import type { VisualRequest } from "../providers.js";

async function download(url: string, dest: string): Promise<string> {
  const bin = await (await fetch(url)).arrayBuffer();
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(bin));
  return dest;
}

/** Reuse a saved face, a local file, a URL, or one FAL still. Null if none of those work. */
export async function ensurePortrait(inf: Influencer, dir: string): Promise<string | null> {
  if (inf.faceImage && /^https?:\/\//.test(inf.faceImage)) {
    const dest = path.join(dir, `${inf.id}-face.png`);
    return download(inf.faceImage, dest);
  }
  if (inf.faceImage && existsSync(inf.faceImage)) return inf.faceImage;
  const cached = portraitCachePath(inf.id);
  if (existsSync(cached)) return cached;
  if (!config.fal.apiKey) return null;

  const prompt =
    `photorealistic vertical smartphone selfie, front camera, ${inf.facePrompt}, ${inf.styleNotes}, ` +
    `one person looking into the lens, natural skin texture, soft indoor light, 9:16. ` +
    `ABSOLUTELY NO text, no letters, no logos, no watermark. Original fictional person, not a celebrity.`;
  log("ugc", `generating portrait for ${inf.name}`);
  const out = await falRun(config.fal.imageModel, {
    prompt,
    image_size: "portrait_16_9",
    num_images: 1,
  });
  const imgUrl = out?.images?.[0]?.url ?? out?.image?.url;
  if (!imgUrl) return null;
  await download(imgUrl, cached);
  await rememberFace(inf.id, cached);
  log("ugc", `portrait cached at ${cached}`);
  return cached;
}

function mimeOf(file: string): string {
  if (/\.jpe?g$/i.test(file)) return "image/jpeg";
  if (/\.webp$/i.test(file)) return "image/webp";
  if (/\.wav$/i.test(file)) return "audio/wav";
  if (/\.mp3$/i.test(file)) return "audio/mpeg";
  return "image/png";
}

async function heygenUpload(filePath: string, key: string): Promise<string> {
  const bytes = await readFile(filePath);
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: mimeOf(filePath) }), path.basename(filePath));
  const res = await fetch("https://api.heygen.com/v3/assets", {
    method: "POST",
    headers: { "X-Api-Key": key },
    body: fd,
  });
  if (!res.ok) {
    throw new Error(`HeyGen asset ${res.status}: ${(await res.text()).slice(0, 180)}`);
  }
  const json = (await res.json()) as { data?: { id?: string; asset_id?: string }; id?: string };
  const id = json.data?.id ?? json.data?.asset_id ?? json.id;
  if (!id) throw new Error("HeyGen asset upload returned no id");
  return id;
}

/**
 * Lip-sync OUR narration onto a HeyGen avatar or the portrait.
 * https://developers.heygen.com/audio-to-video  (POST /v3/videos)
 */
async function heygenTalkingHead(opts: {
  inf: Influencer;
  portrait: string | null;
  audioPath: string;
  dir: string;
  title: string;
}): Promise<string> {
  const key = requireEnv(config.heygen.apiKey, "HEYGEN_API_KEY");
  const audioId = await heygenUpload(opts.audioPath, key);
  const body: Record<string, unknown> = {
    title: opts.title.slice(0, 80) || "ugc",
    audio_asset_id: audioId,
    aspect_ratio: "9:16",
    resolution: "1080p",
    fit: "cover",
    motion_prompt: opts.inf.styleNotes.slice(0, 240),
  };
  if (opts.inf.heygenAvatarId) {
    body.type = "avatar";
    body.avatar_id = opts.inf.heygenAvatarId;
  } else if (opts.portrait) {
    const img = await readFile(opts.portrait);
    body.type = "image";
    body.image = {
      type: "base64",
      media_type: mimeOf(opts.portrait),
      data: img.toString("base64"),
    };
  } else {
    throw new Error("HeyGen needs heygenAvatarId or a portrait image");
  }

  const created = await fetch("https://api.heygen.com/v3/videos", {
    method: "POST",
    headers: { "X-Api-Key": key, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!created.ok) {
    throw new Error(`HeyGen video ${created.status}: ${(await created.text()).slice(0, 200)}`);
  }
  const createdJson = (await created.json()) as { data?: { video_id?: string } };
  const videoId = createdJson.data?.video_id;
  if (!videoId) throw new Error("HeyGen did not return a video_id");
  log("ugc", `HeyGen render ${videoId}…`);

  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(`https://api.heygen.com/v3/videos/${videoId}`, {
      headers: { "X-Api-Key": key },
    });
    if (!res.ok) throw new Error(`HeyGen status ${res.status}`);
    const json = (await res.json()) as {
      data?: { status?: string; video_url?: string; failure_message?: string };
    };
    const status = json.data?.status ?? "";
    if (status === "completed" && json.data?.video_url) {
      return download(json.data.video_url, path.join(opts.dir, "ugc-heygen.mp4"));
    }
    if (status === "failed") {
      throw new Error(json.data?.failure_message || "HeyGen render failed");
    }
    if (i % 3 === 0) log("ugc", `HeyGen … ${status || "pending"}`);
  }
  throw new Error("HeyGen timed out");
}

async function falLipsync(portrait: string, audioPath: string, dir: string): Promise<string> {
  const imageUrl = await falUpload(portrait, mimeOf(portrait));
  const audioUrl = await falUpload(audioPath, mimeOf(audioPath));
  log("ugc", `fal lip-sync ${config.fal.lipsyncModel}`);
  const out = await falRun(config.fal.lipsyncModel, {
    image_url: imageUrl,
    audio_url: audioUrl,
  });
  const vidUrl = out?.video?.url ?? out?.videos?.[0]?.url;
  if (!vidUrl) throw new Error("fal lip-sync returned no video");
  return download(vidUrl, path.join(dir, "ugc-lipsync.mp4"));
}

async function portraitClips(image: string, req: VisualRequest): Promise<string[]> {
  const n = Math.min(Math.max(req.queries.length, 3), 5);
  const paths: string[] = [];
  for (let i = 0; i < n; i++) {
    const clip = path.join(req.dir, `ugc-${String(i).padStart(2, "0")}.mp4`);
    await imageToClip(image, clip, req.clipSeconds, i);
    paths.push(clip);
  }
  return paths;
}

/**
 * Vertical "creator on their phone" visuals.
 * HeyGen lip-sync when that key (and an avatar or portrait) exists.
 * fal sync-lipsync only when UGC_LIPSYNC=1 (it is ~$0.13/sec).
 * Otherwise the same cached portrait with Ken Burns — still the same host.
 * UGC_LIPSYNC=0 forces the portrait path even if HeyGen is configured.
 */
export async function ugcClips(req: VisualRequest): Promise<string[]> {
  const inf = await getActiveInfluencer();
  log("ugc", `host ${inf.name} (${inf.id})`);
  const portrait = await ensurePortrait(inf, req.dir).catch((e: any) => {
    log("ugc", `portrait skipped: ${e.message}`);
    return null;
  });

  const allowLipsync = !config.ugc.lipsyncOff;
  if (allowLipsync && req.audioPath && config.heygen.apiKey && (inf.heygenAvatarId || portrait)) {
    try {
      const video = await heygenTalkingHead({
        inf,
        portrait,
        audioPath: req.audioPath,
        dir: req.dir,
        title: req.topic,
      });
      log("ugc", "HeyGen lip-sync ready");
      return [video];
    } catch (e: any) {
      log("ugc", `HeyGen lip-sync failed (${e.message}) — falling back`);
    }
  }

  if (config.ugc.lipsync && req.audioPath && portrait && config.fal.apiKey) {
    try {
      const video = await falLipsync(portrait, req.audioPath, req.dir);
      log("ugc", "fal lip-sync ready");
      return [video];
    } catch (e: any) {
      log("ugc", `fal lip-sync failed (${e.message}) — falling back to portrait`);
    }
  }

  if (!portrait) {
    throw new Error(
      'UGC needs a face. Set FAL_KEY (portrait), or HEYGEN_API_KEY plus heygenAvatarId on the influencer, or put a file path in faceImage. Run `npx tsx src/cli.ts doctor`.',
    );
  }
  log("ugc", "portrait talking-still (no lip-sync key, or lip-sync declined)");
  return portraitClips(portrait, req);
}
