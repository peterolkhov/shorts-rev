import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { generateObject } from "ai";
import { z } from "zod";
import { config, resolveModel } from "./config.js";
import { log, slug } from "./lib/util.js";

/** Recurring on-camera host. Fictional — not a real creator's likeness. */
export interface Influencer {
  id: string;
  name: string;
  persona: string;
  /** ElevenLabs voice id. Empty = the channel default. */
  voiceId: string;
  /** Local path or https URL of the reference face. Empty = generate with FAL. */
  faceImage: string;
  facePrompt: string;
  styleNotes: string;
  /** HeyGen avatar / look id. Empty = image lip-sync or portrait fallback. */
  heygenAvatarId: string;
  /** Optional HeyGen voice. Unused when we lip-sync our own ElevenLabs track. */
  heygenVoiceId: string;
}

export interface InfluencerRoster {
  activeId: string;
  influencers: Influencer[];
}

const SEED_PATH = path.join(config.root, "assets", "influencers.json");
const RUNTIME_PATH = path.join(config.root, "data", "influencers.json");

export function portraitCachePath(id: string): string {
  return path.join(config.root, "data", "influencers", `${id}.png`);
}

function parseRoster(raw: string): InfluencerRoster {
  const data = JSON.parse(raw) as InfluencerRoster;
  if (!data.influencers?.length) throw new Error("influencer roster is empty");
  return data;
}

function loadRosterSync(): InfluencerRoster {
  const seed = parseRoster(readFileSync(SEED_PATH, "utf8"));
  if (!existsSync(RUNTIME_PATH)) return seed;
  try {
    return mergeRosters(seed, parseRoster(readFileSync(RUNTIME_PATH, "utf8")));
  } catch {
    return seed;
  }
}

function mergeRosters(seed: InfluencerRoster, runtime: InfluencerRoster): InfluencerRoster {
  const byId = new Map(seed.influencers.map((i) => [i.id, i]));
  for (const inf of runtime.influencers) {
    byId.set(inf.id, { ...byId.get(inf.id), ...inf });
  }
  const activeId = runtime.activeId || seed.activeId;
  return { activeId, influencers: [...byId.values()] };
}

export async function loadRoster(): Promise<InfluencerRoster> {
  const seed = parseRoster(await readFile(SEED_PATH, "utf8"));
  try {
    const runtime = parseRoster(await readFile(RUNTIME_PATH, "utf8"));
    return mergeRosters(seed, runtime);
  } catch {
    return seed;
  }
}

export async function saveRoster(roster: InfluencerRoster): Promise<void> {
  await mkdir(path.dirname(RUNTIME_PATH), { recursive: true });
  await writeFile(RUNTIME_PATH, JSON.stringify(roster, null, 2));
}

export function activeIdOf(roster: InfluencerRoster): string {
  return process.env.UGC_INFLUENCER_ID || roster.activeId || roster.influencers[0].id;
}

export async function getActiveInfluencer(): Promise<Influencer> {
  const roster = await loadRoster();
  const id = activeIdOf(roster);
  return roster.influencers.find((i) => i.id === id) ?? roster.influencers[0];
}

/** True when a local reference face already exists (Ken Burns needs no FAL call). */
export function portraitReady(): boolean {
  try {
    const roster = loadRosterSync();
    const id = activeIdOf(roster);
    const inf = roster.influencers.find((i) => i.id === id) ?? roster.influencers[0];
    if (inf.faceImage && !/^https?:\/\//.test(inf.faceImage) && existsSync(inf.faceImage)) {
      return true;
    }
    return existsSync(portraitCachePath(inf.id));
  } catch {
    return false;
  }
}

export async function rememberFace(id: string, faceImage: string): Promise<void> {
  const roster = await loadRoster();
  const inf = roster.influencers.find((i) => i.id === id);
  if (!inf) return;
  inf.faceImage = faceImage;
  await saveRoster(roster);
}

const STARTERS: Omit<Influencer, "id">[] = [
  {
    name: "Avery Cole",
    persona:
      "Avery Cole is a fictional 28-year-old who films money explainers on their phone in a small apartment. Direct, a little sarcastic, one number per video. Never gives personalized investment advice and never pretends a screenshot of their own account is proof.",
    voiceId: "",
    faceImage: "",
    facePrompt:
      "original fictional adult, late 20s, short wavy brown hair, olive skin, grey t-shirt, phone-selfie framing, soft apartment window light, looking into the lens",
    styleNotes: "iPhone front camera, slight handheld, bedroom background, big bottom captions",
    heygenAvatarId: "",
    heygenVoiceId: "",
  },
  {
    name: "Jordan Hale",
    persona:
      "Jordan Hale is a fictional early-30s creator who explains jobs, layoffs, and AI at work like a friend who just read the filing. Calm, specific, no fake personal success story.",
    voiceId: "",
    faceImage: "",
    facePrompt:
      "original fictional adult, early 30s, black hair pulled back, warm medium skin, navy hoodie, phone-selfie framing, kitchen light, looking into the lens",
    styleNotes: "front-camera selfie, kitchen background, conversational, captions low",
    heygenAvatarId: "",
    heygenVoiceId: "",
  },
];

export function scaffoldInfluencer(name?: string): Influencer {
  const template = STARTERS[Math.floor(Math.random() * STARTERS.length)];
  const chosen = name?.trim() || template.name;
  const base = name?.trim() ? { ...template, name: chosen } : template;
  const id = slug(chosen) || `host-${Date.now()}`;
  return {
    ...base,
    id,
    persona: base.persona.replaceAll(template.name, chosen),
    facePrompt: `${base.facePrompt}, character name ${chosen}, not a celebrity, not a real person`,
  };
}

const PersonaSchema = z.object({
  persona: z
    .string()
    .describe("2-3 sentences. Fictional host. No fake income claims. No celebrity likeness."),
  facePrompt: z
    .string()
    .describe("Visual prompt for a phone selfie of an original fictional adult. No celebrity names. No text in frame."),
  styleNotes: z.string().describe("How the phone video should look."),
});

export async function createInfluencer(
  name?: string,
  opts: { portrait?: boolean } = {},
): Promise<Influencer> {
  const roster = await loadRoster();
  let inf = scaffoldInfluencer(name);
  if (roster.influencers.some((i) => i.id === inf.id)) {
    inf = { ...inf, id: `${inf.id}-${Date.now().toString(36)}` };
  }
  if (process.env.ANTHROPIC_API_KEY || process.env.AI_GATEWAY_API_KEY) {
    try {
      const { object } = await generateObject({
        model: resolveModel(),
        schema: PersonaSchema,
        prompt: `Create a FICTIONAL YouTube Shorts host named ${inf.name} for a personal-finance / jobs / AI-labor channel.

They talk to their phone camera. They explain one real idea; they do not fake a rags-to-riches story or impersonate a real influencer.
Return persona, a face prompt for an original adult (no celebrity), and short style notes.`,
      });
      inf = { ...inf, ...object };
    } catch (e: any) {
      log("influencer", `persona LLM skipped: ${e.message}`);
    }
  }
  roster.influencers.push(inf);
  roster.activeId = inf.id;
  await saveRoster(roster);
  log("influencer", `added ${inf.name} (${inf.id}) — active. Edit data/influencers.json to set voiceId / heygenAvatarId.`);

  if (opts.portrait) {
    const { ensurePortrait } = await import("./steps/ugc.js");
    const face = await ensurePortrait(inf, path.join(config.root, "data", "influencers"));
    if (face) log("influencer", `portrait saved: ${face}`);
    else log("influencer", "no portrait — set FAL_KEY or drop a face image path into faceImage");
  }
  return inf;
}

export async function setActiveInfluencer(id: string): Promise<void> {
  const roster = await loadRoster();
  const inf = roster.influencers.find((i) => i.id === id);
  if (!inf) throw new Error(`no influencer "${id}". Run: npx tsx src/cli.ts influencer list`);
  roster.activeId = inf.id;
  await saveRoster(roster);
  log("influencer", `active host is ${inf.name} (${inf.id})`);
}

export async function listInfluencers(): Promise<void> {
  const roster = await loadRoster();
  const active = activeIdOf(roster);
  console.log("\nInfluencers (assets/influencers.json + data/influencers.json):\n");
  for (const inf of roster.influencers) {
    const mark = inf.id === active ? "→" : " ";
    const face = inf.faceImage || (existsSync(portraitCachePath(inf.id)) ? portraitCachePath(inf.id) : "no face yet");
    console.log(`  ${mark} ${inf.id.padEnd(22)} ${inf.name}`);
    console.log(`      voice=${inf.voiceId || "(channel default)"}  heygen=${inf.heygenAvatarId || "(none)"}`);
    console.log(`      face=${face}`);
  }
  console.log("\n  npx tsx src/cli.ts influencer new \"Name\" [--portrait]");
  console.log("  npx tsx src/cli.ts influencer use <id>\n");
}
