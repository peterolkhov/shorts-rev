import { config, requireEnv } from "../config.js";
import { log } from "../lib/util.js";
import { uploadToR2, r2Configured } from "../lib/r2.js";
import { buildCaption } from "./types.js";
import type { Publisher, PublishResult, PublishContext } from "./types.js";
import type { Script } from "../steps/ideate.js";

const GRAPH = "https://graph.facebook.com";
const RUPLOAD = "https://rupload.facebook.com";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const v = () => config.meta.graphVersion;
const token = () => requireEnv(config.meta.accessToken, "META_ACCESS_TOKEN");

/**
 * Ensure the mp4 is at a public URL Meta can fetch. Reuses one the orchestrator
 * already hosted (ctx.publicUrl) so IG + FB don't each re-upload the same file.
 */
async function ensureHosted(videoPath: string, ctx?: PublishContext): Promise<string> {
  if (ctx?.publicUrl) return ctx.publicUrl;
  const key = `reels/${videoPath.split("/").pop()}`;
  return uploadToR2(videoPath, key);
}

async function graphPost(pathSeg: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(`${GRAPH}/${v()}/${pathSeg}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, access_token: token() }).toString(),
  });
  const data = await res.json();
  if (!res.ok || (data as any).error) {
    throw new Error((data as any).error?.message ?? `graph ${res.status}`);
  }
  return data;
}

async function graphGet(pathSeg: string, fields: string): Promise<any> {
  const res = await fetch(
    `${GRAPH}/${v()}/${pathSeg}?fields=${fields}&access_token=${encodeURIComponent(token())}`,
  );
  return res.json();
}

// ─── Instagram Reels ─────────────────────────────────────────────────────
// 1) create a REELS media container pointing at the public video_url
// 2) poll the container until it finishes processing
// 3) publish the container
async function publishInstagram(
  videoPath: string,
  script: Script,
  ctx?: PublishContext,
): Promise<PublishResult> {
  const igUserId = requireEnv(config.meta.igUserId, "IG_USER_ID");
  const videoUrl = await ensureHosted(videoPath, ctx);

  const container = await graphPost(`${igUserId}/media`, {
    media_type: "REELS",
    video_url: videoUrl,
    caption: buildCaption(script),
    share_to_feed: "true",
  });
  const creationId = container.id as string;
  log("instagram", `container ${creationId} processing…`);

  // Meta transcodes async; poll up to ~2.5 min.
  for (let i = 0; i < 30; i++) {
    await sleep(5000);
    const s = await graphGet(creationId, "status_code");
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") {
      return { platform: "instagram", status: "error", detail: `container ${s.status_code}` };
    }
    if (i === 29) {
      return { platform: "instagram", status: "error", detail: "processing timed out" };
    }
  }

  const published = await graphPost(`${igUserId}/media_publish`, { creation_id: creationId });
  const id = published.id as string;
  log("instagram", `published reel ${id}`);
  return {
    platform: "instagram",
    status: "posted",
    id,
    url: `https://instagram.com/reel/${id}`,
  };
}

// ─── Facebook Reels ──────────────────────────────────────────────────────
// Resumable protocol: start → upload (by hosted file_url) → finish(PUBLISHED)
async function publishFacebook(
  videoPath: string,
  script: Script,
  ctx?: PublishContext,
): Promise<PublishResult> {
  const pageId = requireEnv(config.meta.fbPageId, "FB_PAGE_ID");
  const videoUrl = await ensureHosted(videoPath, ctx);

  const start = await graphPost(`${pageId}/video_reels`, { upload_phase: "start" });
  const videoId = start.video_id as string;

  // "Hosted" upload: hand rupload the public file_url instead of raw bytes.
  const up = await fetch(`${RUPLOAD}/video-upload/${v()}/${videoId}`, {
    method: "POST",
    headers: { authorization: `OAuth ${token()}`, file_url: videoUrl },
  });
  if (!up.ok) {
    return { platform: "facebook", status: "error", detail: `upload ${up.status}` };
  }

  await graphPost(`${pageId}/video_reels`, {
    upload_phase: "finish",
    video_id: videoId,
    video_state: "PUBLISHED",
    description: buildCaption(script),
  });
  log("facebook", `published reel ${videoId}`);
  return {
    platform: "facebook",
    status: "posted",
    id: videoId,
    url: `https://facebook.com/reel/${videoId}`,
  };
}

function metaReady(): boolean {
  return Boolean(config.meta.accessToken && r2Configured());
}

export const instagram: Publisher = {
  name: "instagram",
  ledgerKey: "reelId",
  needsPublicUrl: true,
  isConfigured: () => metaReady() && Boolean(config.meta.igUserId),
  publish: (videoPath, script, _privacy, ctx) => publishInstagram(videoPath, script, ctx),
};

export const facebook: Publisher = {
  name: "facebook",
  ledgerKey: "fbReelId",
  needsPublicUrl: true,
  isConfigured: () => metaReady() && Boolean(config.meta.fbPageId),
  publish: (videoPath, script, _privacy, ctx) => publishFacebook(videoPath, script, ctx),
};
