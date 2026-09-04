import "dotenv/config";
import path from "node:path";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

const root = process.cwd();

export const config = {
  root,
  workDir: path.join(root, "work"),
  outDir: path.join(root, "out"),
  // Drop your OWN/licensed gameplay .mp4s here for the "gameplay"/"mixed" look.
  gameplayDir: path.join(root, "gameplay"),

  niche:
    process.env.NICHE ??
    "personal finance and investing: counterintuitive money facts with original analysis",

  // Appended to every description — this is where finance channels actually earn
  // (affiliate links + a follow CTA), not raw Shorts RPM. One entry per line.
  // Pre-monetization, point this at a FREE newsletter to capture the audience you
  // can sell to later; swap in affiliate links (one env change) once approved.
  cta: (process.env.CTA ?? (process.env.NEWSLETTER_URL ? `📈 Free breakdowns → ${process.env.NEWSLETTER_URL}` : ""))
    .split("\\n")
    .filter(Boolean),
  newsletterUrl: process.env.NEWSLETTER_URL ?? "",

  // Which platforms `crosspost`/`cycle` fan out to. Comma-separated. A platform is
  // only actually attempted if its keys are present (each adapter self-checks), so
  // leaving all four on is safe — unconfigured ones are skipped, not errored.
  platforms: (process.env.PLATFORMS ?? "youtube,tiktok,instagram,facebook")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Model string. With AI_GATEWAY_API_KEY set, "anthropic/..." routes through
  // the Vercel AI Gateway. Swap to "openai/gpt-4o" etc. if you prefer.
  model: process.env.MODEL ?? "anthropic/claude-sonnet-5",

  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY ?? "",
    voiceId: process.env.ELEVENLABS_VOICE_ID ?? "pNInz6obpgDQGcFmaJgB",
    modelId: "eleven_multilingual_v2",
  },

  pexels: {
    apiKey: process.env.PEXELS_API_KEY ?? "",
  },

  // Royalty-free gameplay/satisfying background footage (free API, no attribution).
  pixabay: {
    apiKey: process.env.PIXABAY_API_KEY ?? "",
  },

  // fal.ai — one key unlocks AI image + video models. Model ids are configurable
  // because fal's catalog moves fast; check https://fal.ai/models if one 404s.
  fal: {
    apiKey: process.env.FAL_KEY ?? "",
    imageModel: process.env.FAL_IMAGE_MODEL ?? "fal-ai/flux/schnell", // fast + cheap
    videoModel: process.env.FAL_VIDEO_MODEL ?? "fal-ai/wan/v2.2-a14b/text-to-video", // cheap motion
    // HARD CAPS on paid AI generations per video. The LLM may return up to 8
    // visual beats; we never generate more than this many (clips loop to fill).
    // Keep videos low — they're the expensive one.
    maxImages: Number(process.env.FAL_MAX_IMAGES ?? 5),
    maxVideos: Number(process.env.FAL_MAX_VIDEOS ?? 3),
  },

  youtube: {
    clientId: process.env.YOUTUBE_CLIENT_ID ?? "",
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET ?? "",
    privacy: (process.env.YOUTUBE_PRIVACY ?? "private") as
      | "private"
      | "unlisted"
      | "public",
    tokenPath: path.join(root, "youtube-token.json"),
  },

  // ── Cross-posting ──────────────────────────────────────────────────────
  // TikTok Content Posting API. Register an app at developers.tiktok.com.
  // Unaudited apps can only push to the user's INBOX as a draft (you tap publish
  // in-app); once audited, set TIKTOK_DIRECT_POST=1 for full auto-publish.
  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY ?? "",
    clientSecret: process.env.TIKTOK_CLIENT_SECRET ?? "",
    tokenPath: path.join(root, "tiktok-token.json"),
    directPost: process.env.TIKTOK_DIRECT_POST === "1", // needs an audited app
  },

  // Meta Graph API — Instagram Reels + Facebook Reels. One app + one long-lived
  // token covers both. Meta PULLS the video from a public URL (see r2 below);
  // it does not accept a byte upload for Reels.
  meta: {
    accessToken: process.env.META_ACCESS_TOKEN ?? "", // long-lived page token
    igUserId: process.env.IG_USER_ID ?? "", // Instagram Business account id
    fbPageId: process.env.FB_PAGE_ID ?? "", // Facebook Page id
    graphVersion: process.env.META_GRAPH_VERSION ?? "v21.0",
  },

  // Cloudflare R2 (S3-compatible) — public host for the mp4 so Meta can fetch it.
  // Enable the bucket's public r2.dev URL or attach a custom domain, and put that
  // origin in R2_PUBLIC_BASE_URL.
  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    bucket: process.env.R2_BUCKET ?? "",
    publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/$/, ""),
  },

  video: {
    width: 1080,
    height: 1920,
    fps: 30,
    segmentSeconds: 2.4, // how long each B-roll clip shows before cutting (rapid)
    flair: (process.env.FLAIR ?? "on") !== "off", // red circles/arrows callouts
  },

  audio: {
    // Attention SFX intensity: "off" | "subtle" | "full".
    //  - subtle (default): soft, low, spaced-out cues (much less "beeping")
    //  - full: a cue on every caption chunk (the old louder behavior)
    //  - off: pure voice. (SFX=off still forces off for back-compat.)
    sfxIntensity: (process.env.SFX === "off"
      ? "off"
      : (process.env.SFX_INTENSITY ?? "subtle")) as "off" | "subtle" | "full",
    sfx:
      process.env.SFX === "off"
        ? false
        : (process.env.SFX_INTENSITY ?? "subtle") !== "off",
    // Optional background music: drop .mp3s in ./music (ducked under voice).
    musicDir: path.join(root, "music"),
  },
};

/**
 * Resolve the LLM. Easiest path: set ANTHROPIC_API_KEY (a direct key from
 * console.anthropic.com) — no extra signups. If instead you set
 * AI_GATEWAY_API_KEY, the plain "anthropic/..." string routes through the
 * Vercel AI Gateway. Direct key wins when both are present.
 */
export function resolveModel(): LanguageModel {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const anthropic = createAnthropic({ apiKey: anthropicKey });
    const id = config.model.replace(/^anthropic\//, "");
    return anthropic(id);
  }
  return config.model; // gateway string
}

export function requireEnv(value: string, name: string): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}
