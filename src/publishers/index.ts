import { config } from "../config.js";
import { log } from "../lib/util.js";
import { updateEntry } from "../ledger.js";
import { uploadToR2, r2Configured } from "../lib/r2.js";
import { youtube } from "./youtube.js";
import { tiktok } from "./tiktok.js";
import { instagram, facebook } from "./meta.js";
import type { Publisher, PublishResult, PublishContext } from "./types.js";
import type { Script } from "../steps/ideate.js";

export type { PublishResult } from "./types.js";
export { authorizeTiktok } from "./tiktok.js";

const ALL: Publisher[] = [youtube, tiktok, instagram, facebook];

/** Publishers named in PLATFORMS, in a stable order. */
function selected(): Publisher[] {
  return config.platforms
    .map((name) => ALL.find((p) => p.name === name))
    .filter((p): p is Publisher => Boolean(p));
}

/**
 * Fan a finished mp4 out to every configured platform in PLATFORMS. Never
 * throws for one platform — each gets a PublishResult (posted/draft/skipped/
 * error) so one failure never sinks the rest. Records each platform's post id
 * (and the R2 URL) back onto the ledger entry.
 */
export async function publishAll(
  ledgerId: string,
  videoPath: string,
  script: Script,
  privacy: "private" | "unlisted" | "public" = "public",
): Promise<PublishResult[]> {
  const publishers = selected();
  const active = publishers.filter((p) => p.isConfigured());

  // Host the mp4 once if any active platform pulls by URL (Meta), then share it.
  const ctx: PublishContext = {};
  if (active.some((p) => p.needsPublicUrl) && r2Configured()) {
    try {
      const key = `reels/${videoPath.split("/").pop()}`;
      ctx.publicUrl = await uploadToR2(videoPath, key);
      await updateEntry(ledgerId, { publicUrl: ctx.publicUrl });
    } catch (e: any) {
      log("publish", `R2 host failed (Meta will be skipped): ${e.message}`);
    }
  }

  const results: PublishResult[] = [];
  for (const p of publishers) {
    if (!p.isConfigured()) {
      results.push({ platform: p.name, status: "skipped", detail: "not configured" });
      continue;
    }
    if (p.needsPublicUrl && !ctx.publicUrl) {
      results.push({ platform: p.name, status: "skipped", detail: "no public host (R2)" });
      continue;
    }
    try {
      const r = await p.publish(videoPath, script, privacy, ctx);
      results.push(r);
      if (r.id) await updateEntry(ledgerId, { [p.ledgerKey]: r.id } as any);
    } catch (e: any) {
      log("publish", `${p.name} failed: ${e.message}`);
      results.push({ platform: p.name, status: "error", detail: e.message });
    }
  }

  const summary = results
    .map((r) => `${r.platform}:${r.status === "posted" ? "✓" : r.status === "draft" ? "◐" : r.status === "error" ? "✗" : "–"}`)
    .join("  ");
  log("publish", summary);
  return results;
}

/** For the `platforms` CLI command — show what's wired vs missing. */
export function describePublishers(): { name: string; enabled: boolean; configured: boolean; needsPublicUrl: boolean }[] {
  const on = new Set(config.platforms);
  return ALL.map((p) => ({
    name: p.name,
    enabled: on.has(p.name),
    configured: p.isConfigured(),
    needsPublicUrl: Boolean(p.needsPublicUrl),
  }));
}
