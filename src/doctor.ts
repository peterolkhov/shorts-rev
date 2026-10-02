import { readFile } from "node:fs/promises";
import { config } from "./config.js";
import { FORMATS, availableFormats } from "./formats.js";
import { getActiveInfluencer, portraitReady } from "./influencers.js";
import { loadPlaybook } from "./playbook.js";
import { estimateCost } from "./preflight.js";
import { authedClient } from "./steps/upload.js";

type Check = { name: string; ok: boolean; detail: string };

/**
 * Pre-flight everything WITHOUT spending: validate keys with free/cheap probes,
 * show ElevenLabs credits, confirm the YouTube token works, and print the
 * estimated $/video for each enabled format so cost is never a surprise.
 */
export async function doctor(): Promise<void> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail = "") =>
    checks.push({ name, ok, detail });

  // Script LLM — presence only (a live call would cost).
  const hasLLM = !!(process.env.ANTHROPIC_API_KEY || process.env.AI_GATEWAY_API_KEY);
  add("Script LLM key", hasLLM, hasLLM ? "present" : "set ANTHROPIC_API_KEY");

  // ElevenLabs — free /user endpoint validates key AND shows remaining credits.
  if (config.elevenlabs.apiKey) {
    try {
      const r = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
        headers: { "xi-api-key": config.elevenlabs.apiKey },
      });
      if (r.ok) {
        const s = (await r.json()) as { character_count: number; character_limit: number };
        const left = s.character_limit - s.character_count;
        add("ElevenLabs", true, `valid — ${left.toLocaleString()} chars left (~${Math.floor(left / 700)} videos)`);
      } else add("ElevenLabs", false, `key rejected (${r.status})`);
    } catch (e: any) {
      add("ElevenLabs", false, e.message);
    }
  } else add("ElevenLabs", false, "ELEVENLABS_API_KEY missing");

  // Pexels — cheap search probe.
  await probe("Pexels", config.pexels.apiKey, add, () =>
    fetch("https://api.pexels.com/videos/search?query=money&per_page=1", {
      headers: { Authorization: config.pexels.apiKey },
    }),
  );

  // Pixabay — cheap probe.
  await probe("Pixabay (gameplay)", config.pixabay.apiKey, add, () =>
    fetch(`https://pixabay.com/api/videos/?key=${config.pixabay.apiKey}&per_page=3`),
  );

  // fal — presence only; validating costs money.
  add(
    "fal.ai (AI visuals)",
    !!config.fal.apiKey,
    config.fal.apiKey
      ? "present (not billed to verify) — unlocks AI formats + UGC portrait"
      : "FAL_KEY missing — AI formats + generated UGC portraits disabled. https://fal.ai/dashboard/keys",
  );

  // HeyGen — cheap identity probe. Lip-sync is optional; portrait UGC does not need it.
  if (config.heygen.apiKey) {
    try {
      const r = await fetch("https://api.heygen.com/v3/users/me", {
        headers: { "X-Api-Key": config.heygen.apiKey },
        signal: AbortSignal.timeout(8000),
      });
      add(
        "HeyGen (UGC lip-sync)",
        r.ok,
        r.ok
          ? "valid — audio-to-video on POST /v3/videos"
          : `key rejected (${r.status}). https://developers.heygen.com/docs/api-key`,
      );
    } catch (e: any) {
      add("HeyGen (UGC lip-sync)", false, e.message);
    }
  } else {
    add(
      "HeyGen (UGC lip-sync)",
      false,
      "optional — set HEYGEN_API_KEY for avatar lip-sync. Signup: https://app.heygen.com/  · key: https://developers.heygen.com/docs/api-key",
    );
  }

  // YouTube — refresh the access token (proves the grant is valid; needs no
  // extra scope, unlike channels.list which would require youtube.readonly).
  try {
    await readFile(config.youtube.tokenPath, "utf8");
    const client = await authedClient();
    const t = await client.getAccessToken();
    add("YouTube auth", !!t.token, t.token ? "authorized — token refreshes OK (upload + analytics)" : "token present but refresh failed");
  } catch (e: any) {
    add("YouTube auth", false, e.message?.includes("ENOENT") ? "not authorized — run npm run auth" : e.message);
  }

  // ── report ──
  console.log("\nCredential check:");
  for (const c of checks) console.log(`  ${c.ok ? "✅" : "❌"} ${c.name.padEnd(22)} ${c.detail}`);

  const pb = await loadPlaybook();
  const runnable = availableFormats(pb.enabledFormats).map((f) => f.id);
  console.log("\nFormats & estimated cost per video:");
  for (const f of FORMATS) {
    const enabled = pb.enabledFormats.includes(f.id);
    const ready = runnable.includes(f.id);
    const mark = !enabled ? "⚪ off" : ready ? "🟢 ready" : "🔴 needs key";
    const needs = f.requiresAny?.length
      ? `one of ${f.requiresAny.join(" | ")}`
      : f.requires.join(", ") || "free visuals";
    const extra =
      f.id === "ugc-talking-head" && config.heygen.apiKey && !config.ugc.lipsyncOff
        ? " + HeyGen plan"
        : f.id === "ugc-talking-head" && config.ugc.lipsync
          ? " fal lipsync ~$0.13/s"
          : "";
    console.log(`  ${mark.padEnd(14)} ${f.id.padEnd(22)} ~$${estimateCost(f).toFixed(2)}   (${needs})${extra}`);
  }

  const host = await getActiveInfluencer().catch(() => null);
  const face = portraitReady();
  const demoVisual = !!(config.pexels.apiKey || config.pixabay.apiKey || config.fal.apiKey);
  const ugcPortrait = !!(config.fal.apiKey || face);
  const ugcLipsync =
    !config.ugc.lipsyncOff &&
    (!!config.heygen.apiKey || (config.ugc.lipsync && !!config.fal.apiKey));
  console.log("\nReadiness:");
  console.log(
    `  ${config.news.apiKey ? "✅" : "⚪"} News — RSS works with zero keys (npm run news). ${
      config.news.apiKey ? "NEWS_API_KEY set" : "NEWS_API_KEY optional: https://newsapi.org/register"
    }`,
  );
  console.log(
    `  ${demoVisual ? "✅" : "❌"} Demo  — stock / slideshow / gameplay needs Pexels, Pixabay, or FAL, plus a script key and ElevenLabs`,
  );
  console.log(
    `  ${ugcPortrait ? "✅" : "❌"} UGC portrait — ${
      ugcPortrait
        ? face
          ? "saved face on disk (Ken Burns, no extra image call)"
          : "FAL_KEY can generate a recurring portrait"
        : "set FAL_KEY or put a faceImage path on the influencer"
    }`,
  );
  console.log(
    `  ${ugcLipsync ? "✅" : "⚪"} UGC lip-sync — ${
      config.ugc.lipsyncOff
        ? "off (UGC_LIPSYNC=0) — portrait only"
        : config.heygen.apiKey
          ? "HeyGen key set (falls back to portrait if the render fails)"
          : "set HEYGEN_API_KEY, or UGC_LIPSYNC=1 to use fal sync-lipsync (~$0.13/sec)"
    }`,
  );
  if (host) {
    console.log(`  host: ${host.name} (${host.id})${host.heygenAvatarId ? ` avatar ${host.heygenAvatarId}` : " — no heygenAvatarId (image lip-sync or portrait)"}`);
    console.log("  roster: assets/influencers.json, overrides in data/influencers.json");
    console.log('  new host: npx tsx src/cli.ts influencer new "Name" [--portrait]');
  }
  console.log("");
}

async function probe(
  name: string,
  key: string,
  add: (n: string, ok: boolean, d?: string) => void,
  call: () => Promise<Response>,
) {
  if (!key) return add(name, false, "key missing");
  try {
    const r = await call();
    add(name, r.ok, r.ok ? "valid" : `rejected (${r.status})`);
  } catch (e: any) {
    add(name, false, e.message);
  }
}
