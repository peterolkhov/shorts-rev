import { readFile, writeFile, stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { config, requireEnv } from "../config.js";
import { log } from "../lib/util.js";
import { buildCaption } from "./types.js";
import type { Publisher, PublishResult } from "./types.js";
import type { Script } from "../steps/ideate.js";

const AUTH_BASE = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const API = "https://open.tiktokapis.com/v2";
const CALLBACK_PORT = 4712; // distinct from YouTube's 4711
const REDIRECT = `http://localhost:${CALLBACK_PORT}/`;
const SCOPES = "video.upload,video.publish";
const MAX_SINGLE_CHUNK = 64 * 1024 * 1024; // TikTok single-chunk ceiling

interface TikTokToken {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch seconds
  open_id?: string;
}

async function saveToken(t: TikTokToken): Promise<void> {
  await writeFile(config.tiktok.tokenPath, JSON.stringify(t, null, 2));
}

async function loadToken(): Promise<TikTokToken | null> {
  try {
    return JSON.parse(await readFile(config.tiktok.tokenPath, "utf8")) as TikTokToken;
  } catch {
    return null;
  }
}

function form(body: Record<string, string>): string {
  return new URLSearchParams(body).toString();
}

/** One-time consent via loopback (same UX as `npm run auth` for YouTube). */
export async function authorizeTiktok(): Promise<void> {
  const clientKey = requireEnv(config.tiktok.clientKey, "TIKTOK_CLIENT_KEY");
  requireEnv(config.tiktok.clientSecret, "TIKTOK_CLIENT_SECRET");

  const state = String(Date.now());
  const url =
    `${AUTH_BASE}?client_key=${encodeURIComponent(clientKey)}` +
    `&scope=${encodeURIComponent(SCOPES)}&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT)}&state=${state}`;

  console.log("\nOpen this URL and approve access:\n\n" + url + "\n");
  console.log(
    `Note: add "${REDIRECT}" to your app's allowed redirect URIs first.\n` +
      "Waiting for you to approve…",
  );

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "", REDIRECT);
      const c = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<body style="font:600 20px system-ui;padding:3rem;text-align:center">${
          c ? "✅ Authorized. You can close this tab." : "❌ " + (err ?? "no code")
        }</body>`,
      );
      server.close();
      c ? resolve(c) : reject(new Error(err ?? "authorization failed"));
    });
    server.on("error", reject);
    server.listen(CALLBACK_PORT);
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({
      client_key: clientKey,
      client_secret: config.tiktok.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT,
    }),
  });
  const data = (await res.json()) as any;
  if (!res.ok || data.error) {
    throw new Error(`TikTok token exchange failed: ${data.error_description ?? JSON.stringify(data)}`);
  }
  await saveToken({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: nowSec() + Number(data.expires_in ?? 86400),
    open_id: data.open_id,
  });
  log("tiktok-auth", `saved credentials to ${config.tiktok.tokenPath}`);
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** Return a valid access token, refreshing if it's within 60s of expiry. */
async function freshAccessToken(): Promise<string> {
  const t = await loadToken();
  if (!t) throw new Error("TikTok not authorized. Run: npx tsx src/cli.ts tiktok-auth");
  if (t.expires_at - 60 > nowSec()) return t.access_token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({
      client_key: config.tiktok.clientKey,
      client_secret: config.tiktok.clientSecret,
      grant_type: "refresh_token",
      refresh_token: t.refresh_token,
    }),
  });
  const data = (await res.json()) as any;
  if (!res.ok || data.error) {
    throw new Error(`TikTok token refresh failed: ${data.error_description ?? JSON.stringify(data)}`);
  }
  const next: TikTokToken = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? t.refresh_token,
    expires_at: nowSec() + Number(data.expires_in ?? 86400),
    open_id: t.open_id,
  };
  await saveToken(next);
  return next.access_token;
}

/** PUT the whole file to TikTok's returned upload_url (single chunk). */
async function uploadBytes(uploadUrl: string, videoPath: string, size: number): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": "video/mp4",
      "content-length": String(size),
      "content-range": `bytes 0-${size - 1}/${size}`,
    },
    body: createReadStream(videoPath) as any,
    duplex: "half",
  } as any);
  if (!res.ok) {
    throw new Error(`TikTok chunk upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

export const tiktok: Publisher = {
  name: "tiktok",
  ledgerKey: "tiktokId",

  isConfigured() {
    return Boolean(
      config.tiktok.clientKey &&
        config.tiktok.clientSecret &&
        existsSync(config.tiktok.tokenPath),
    );
  },

  async publish(videoPath: string, script: Script): Promise<PublishResult> {
    const token = await freshAccessToken();
    const size = (await stat(videoPath)).size;
    if (size > MAX_SINGLE_CHUNK) {
      return {
        platform: "tiktok",
        status: "error",
        detail: `video ${(size / 1e6).toFixed(1)}MB exceeds single-chunk 64MB (add chunking)`,
      };
    }

    const direct = config.tiktok.directPost;
    // Direct post publishes live (needs an AUDITED app + a privacy_level).
    // Inbox mode drops a draft into the app for you to publish by hand — the
    // default, because it works on an unaudited app.
    const initUrl = direct
      ? `${API}/post/publish/video/init/`
      : `${API}/post/publish/inbox/video/init/`;
    const initBody: any = {
      source_info: {
        source: "FILE_UPLOAD",
        video_size: size,
        chunk_size: size,
        total_chunk_count: 1,
      },
    };
    if (direct) {
      initBody.post_info = {
        title: buildCaption(script),
        privacy_level: "SELF_ONLY", // safest default; widen once audited & trusted
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false,
      };
    }

    const initRes = await fetch(initUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(initBody),
    });
    const init = (await initRes.json()) as any;
    if (!initRes.ok || init.error?.code !== "ok") {
      return {
        platform: "tiktok",
        status: "error",
        detail: init.error?.message ?? `init ${initRes.status}`,
      };
    }

    await uploadBytes(init.data.upload_url, videoPath, size);
    const publishId = init.data.publish_id as string;
    log(
      "tiktok",
      direct
        ? `direct-post submitted (${publishId})`
        : `draft pushed to inbox — open TikTok to publish (${publishId})`,
    );
    return {
      platform: "tiktok",
      status: direct ? "posted" : "draft",
      id: publishId,
      detail: direct ? undefined : "draft in TikTok inbox — tap publish in-app",
    };
  },
};
