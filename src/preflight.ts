import { config } from "./config.js";
import type { Format } from "./formats.js";

/** Every env key a given format needs to run end-to-end. */
export function requiredKeys(format: Format): string[] {
  const keys: string[] = [];
  // script LLM: either a direct Anthropic key or the gateway
  if (!process.env.ANTHROPIC_API_KEY && !process.env.AI_GATEWAY_API_KEY) {
    keys.push("ANTHROPIC_API_KEY (or AI_GATEWAY_API_KEY)");
  }
  if (!process.env.ELEVENLABS_API_KEY) keys.push("ELEVENLABS_API_KEY");
  for (const k of format.requires) if (!process.env[k]) keys.push(k);
  return keys;
}

/**
 * Fail BEFORE spending a cent. If any key needed for this video is missing, we
 * throw before the first paid call (script/voice/visuals) instead of paying for
 * the script and then crashing at the voice step.
 */
export function assertReady(format: Format): void {
  const missing = requiredKeys(format);
  if (missing.length) {
    throw new Error(
      `Not ready to spend on "${format.id}". Missing: ${missing.join(", ")}. ` +
        `Fill them in .env (run \`npx tsx src/cli.ts doctor\` to check everything).`,
    );
  }
}

/** Rough $ estimate per video for a format, so cost is never a surprise. */
export function estimateCost(format: Format): number {
  const script = 0.01;
  const voice = 0.05; // ~700 chars; free on ElevenLabs' free tier
  let visuals = 0;
  if (format.provider === "ai-image") visuals = config.fal.maxImages * 0.01;
  if (format.provider === "ai-video")
    visuals = config.fal.maxVideos * format.clipSeconds * 0.12;
  return Math.round((script + voice + visuals) * 100) / 100;
}
