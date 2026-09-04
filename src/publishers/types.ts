import { config } from "../config.js";
import type { Script } from "../steps/ideate.js";
import type { LedgerEntry } from "../types.js";

export type PublishStatus = "posted" | "draft" | "skipped" | "error";

export interface PublishResult {
  platform: string;
  status: PublishStatus;
  id?: string; // platform-native id, stored on the ledger entry
  url?: string; // watch URL when we have one
  detail?: string; // human note (why skipped, error message, "draft in inbox", …)
}

export interface Publisher {
  /** Stable name, also the ledger/PLATFORMS key: youtube|tiktok|instagram|facebook. */
  name: string;
  /** Which LedgerEntry field stores this platform's post id. */
  ledgerKey: keyof LedgerEntry;
  /** True when every required key/token is present. */
  isConfigured(): boolean;
  /** Does this platform need the mp4 hosted at a public URL first? (Meta does.) */
  needsPublicUrl?: boolean;
  /** Publish one finished mp4. Must not throw for a "skipped" config gap. */
  publish(
    videoPath: string,
    script: Script,
    privacy: "private" | "unlisted" | "public",
    ctx?: PublishContext,
  ): Promise<PublishResult>;
}

/** Extra data the orchestrator can hand a publisher (e.g. a pre-hosted URL). */
export interface PublishContext {
  publicUrl?: string; // mp4 already uploaded to R2, so Meta adapters reuse it
}

/**
 * A caption string for the caption-based platforms (TikTok/IG/FB), as opposed
 * to YouTube's separate title+description fields. Hook up top for the scroll,
 * then the CTA, then hashtags from the script's tags.
 */
export function buildCaption(script: Script): string {
  const cta = config.cta.length ? `\n\n${config.cta.join("\n")}` : "";
  const hashtags = script.tags
    .slice(0, 8)
    .map((t) => "#" + t.replace(/[^a-zA-Z0-9]/g, ""))
    .filter((t) => t.length > 1)
    .join(" ");
  const body = script.description?.trim() || script.title;
  return `${body}${cta}\n\n${hashtags}`.slice(0, 2200); // IG caption cap
}
