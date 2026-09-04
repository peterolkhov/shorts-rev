import { generateObject } from "ai";
import { z } from "zod";
import { resolveModel } from "../config.js";
import { STRATEGY_RULES } from "../strategy.js";
import { log } from "../lib/util.js";
import { loadViralHooks } from "./spy.js";
import type { Playbook } from "../types.js";
import type { Track } from "../tracks.js";

// The model sometimes returns these as a comma-separated STRING instead of an
// array — coerce so validation never fails on that.
const stringList = (min: number, max: number) =>
  z.preprocess(
    (v) =>
      typeof v === "string"
        ? v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
        : v,
    z.array(z.string()).min(min).max(max),
  );

export const ScriptSchema = z.object({
  topic: z.string().describe("The single specific insight this short delivers"),
  hook: z
    .string()
    .describe("First spoken line. Opens a curiosity gap in <2s. No 'Did you know'."),
  narration: z
    .string()
    .describe(
      "Full voiceover written to be SPOKEN as ONE coherent 3-act script (setup → turn → payoff), each sentence logically following the last so the viewer can follow along start to finish. The TURN — the surprising pivot the hook promised — MUST arrive within the first one or two sentences (by ~second 5); never bury it behind throat-clearing. Tight and punchy — every word earns its place. One thread. Ends on a snappy BUTTON that (a) invites a comment and (b) loops cleanly — its last beat should hand back into the hook so a rewatch feels seamless. Never restate the hook verbatim.",
    ),
  brollQueries: stringList(3, 8).describe(
    "One visual per narration beat, IN ORDER, each illustrating the sentence it plays under so images help the viewer follow the story (not random flashing). 2-4 words, concrete. The FIRST query is the HOOK FRAME — it plays under the first ~2 seconds and IS the video's de-facto thumbnail, so it must be the single most striking, high-contrast, scroll-stopping image in the set: a bold face, a huge number/dollar figure, or one vivid object — never an abstract or generic backdrop. When the script names a real person/company/place, use that exact real name here (e.g. 'Warren Buffett', 'JPMorgan headquarters') so a real photo can be found.",
  ),
  title: z
    .string()
    .describe(
      "YouTube title, <70 chars. MrBeast-style clickbait — a bold specific claim, number, or curiosity gap that makes the click irresistible — but it MUST be TRUE and delivered by the video (no bait-and-switch).",
    ),
  description: z.string().describe("2-3 sentences with 3-5 hashtags"),
  tags: stringList(3, 15),
});

export type Script = z.infer<typeof ScriptSchema>;

export async function ideate(
  pb: Playbook,
  track: Track,
  targetLengthSec: number,
  scriptDirective: string,
  seed?: string,
  recentTopics: string[] = [],
): Promise<{ script: Script; prompt: string }> {
  const words = Math.round(targetLengthSec * 2.1); // measured ElevenLabs rate
  log("ideate", `[${track.id}] target ~${targetLengthSec}s (<=${words} words)`);

  // The closing directive depends on the lane: explain-with-a-number for the
  // finance lanes, react→explain→take for current events, escalating-bit for
  // the comedy lanes. All three demand ONE coherent, followable thread.
  const laneDirective =
    track.id === "finance" || track.id === "shareholder-letters"
      ? 'Write ONE short as a COHERENT SCRIPT that walks the viewer through a single idea step by step (setup → the turn → the payoff). It MUST include a genuine original insight, with ONE concrete number explained in plain steps so a smart adult actually "gets it" in 40 seconds — teach it, don\'t just assert it. Every claim TRUE, no invented statistics or quotes.'
      : track.id === "current-events"
        ? "Write ONE short as a COHERENT reaction: what actually happened → why it matters → your take, one clear thread the viewer can follow. Fast clickbait energy but never scattered. Only reference what was genuinely said or done publicly; state opinions clearly AS opinions; never fabricate quotes or events."
        : "Write ONE short as a COHERENT bit that ESCALATES one clear premise (setup → escalation → button), simple and vivid enough for a 12-year-old to follow effortlessly. Genuinely funny, absurd-but-relatable, never scattered, never mean-spirited or false.";

  const viral = (await loadViralHooks()).slice(0, 8);

  const prompt = `You are the scriptwriter for a faceless YouTube Shorts channel with a CONSISTENT, recognizable voice.

CONTENT TRACK: ${track.label}
What this channel makes here: ${track.domain}
Tone: ${track.toneDirective}

${STRATEGY_RULES}

Angles to lean into: ${track.seedAngles.join(" | ")}
Avoid: ${track.avoid.join(" | ")}
General hook guidance (learned): ${pb.hookGuidance}${
    pb.replicate && !/no clear outlier|keep exploring/i.test(pb.replicate)
      ? `\n\n🏆 PROVEN WINNER TO BUILD ON — our best-performing formula so far. Lean toward its HOOK SHAPE and TOPIC ANGLE (reword it, fresh specifics — don't copy verbatim, don't repeat a recent topic). This is how we turn one hit into a repeatable series instead of reinventing every time:\n${pb.replicate}`
      : ""
  }

FORMAT for this specific video (match this delivery): ${scriptDirective}

⚠️ HARD LIMIT: the narration must be ${words} words or FEWER (target ~${targetLengthSec}s spoken). Count your words. A Short that runs long gets swiped away — brevity is non-negotiable. Cut every filler word; keep only the hook, the payoff, and the button.
${seed ? `Specific angle to cover: ${seed}` : "Pick a fresh, specific angle in the directions above — don't repeat a tired take."}
${
  recentTopics.length
    ? `\n🚫 ALREADY COVERED — pick a DIFFERENT angle, do not restate any of these (not even reworded):\n${recentTopics.map((t) => `- ${t}`).join("\n")}`
    : ""
}

THE HOOK IS 90% OF THE VIDEO. A viewer decides to keep watching in ~1 second. Your first line must do ONE of these hard:
- Make a specific, contrarian claim that sounds almost wrong ("Paying off your mortgage early can make you poorer.")
- Name the exact mistake the viewer is probably making right now ("You're stopping your 401k at the match. That's the trap.")
- Open a loop the payoff must close ("There's one number on your paycheck your employer hopes you never calculate.")
- Use a vivid, concrete image over an abstraction (a napkin calculator, not "financial confusion").
NEVER open with "Did you know", a definition, or a slow wind-up. First 5 words carry the whole thing — front-load the tension.

Examples of the HOOK energy (match the vibe, don't copy the topic):
${track.seedHooks.map((h) => `- "${h}"`).join("\n")}
${
  viral.length
    ? `\n🔥 GOING VIRAL on finance Shorts RIGHT NOW (millions of views each). STEAL THE HOOK SHAPE — the curiosity mechanism/structure — and swap in our own specifics. Do NOT copy a topic verbatim; adapt the SKELETON:\n${viral.map((v) => `- "${v.title}" (${Math.round(v.views / 1000)}k views)`).join("\n")}\n`
    : ""
}
⚡ DELIVERY ENERGY (non-negotiable): write with HIGH energy and high stakes — confident, urgent, like a young creator who genuinely believes this is life-changing and can't wait to blurt it out. Bold TRUE claims, short punchy sentences, a real sense that this MATTERS right now. Never flat, never lecture-y, never hedged. If a line sounds like a textbook, rewrite it like a hyped-up friend telling you a secret.

THE OPENING FRAME. On Shorts there is no thumbnail in the feed — the FIRST visual on screen IS your thumbnail, and it's decided in the first ~2 seconds. So brollQueries[0] must be a genuine scroll-stopper: a bold human face, a giant dollar figure/number, or one vivid concrete object with high contrast — never a generic backdrop, chart, or abstract concept. Pair it with a hook line that pays off fast.

DELIVER FAST — NO WIND-UP. Do not spend the first line "setting up." State the surprising thing, then explain it. The TURN the hook promised must land by about second 5 or the viewer swipes.

THE LOOP. Shorts reward re-watches. Write the final line as a tight button that lands the payoff AND flows naturally back into the hook, so if the video restarts it feels seamless — this quietly earns replays. Still leave a reason to comment. Never repeat the hook word-for-word.

${laneDirective}

Every sentence must logically follow the one before it — a viewer should be able to follow the whole thing like a story, not a list of facts. The brollQueries must track the script beat-by-beat, in order.
Return the structured script.`;

  // The model occasionally returns output that fails schema validation — retry
  // a couple times so a transient hiccup never kills an automated run.
  let object: Script | undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5 && !object; attempt++) {
    try {
      object = (
        await generateObject({
          model: resolveModel(),
          schema: ScriptSchema,
          prompt,
          // Salvage responses where the model wrapped the JSON in prose or leaked
          // tool-call XML — strip tags and extract the outermost JSON object.
          experimental_repairText: async ({ text }) => {
            const stripped = text.replace(/<[^>]*>/g, "");
            const a = stripped.indexOf("{");
            const b = stripped.lastIndexOf("}");
            return a >= 0 && b > a ? stripped.slice(a, b + 1) : null;
          },
        })
      ).object;
    } catch (e) {
      lastErr = e;
      log("ideate", `attempt ${attempt + 1} failed, retrying…`);
    }
  }
  if (!object) throw lastErr;

  // Harden brollQueries: models occasionally leak XML/tool-call junk or wrap the
  // list in brackets/quotes. Strip tags, stray brackets/quotes, and empties.
  object.brollQueries = object.brollQueries
    .map((q) =>
      q
        .replace(/<[^>]*>/g, "") // stray tags
        .replace(/^[\s"'`\[\]]+|[\s"'`\[\]]+$/g, "") // wrapping brackets/quotes
        .trim(),
    )
    .filter((q) => q.length > 1 && !/^parameter\b/i.test(q));
  if (object.brollQueries.length < 3) {
    object.brollQueries = [object.topic, ...object.brollQueries].slice(0, 6);
  }

  log("ideate", `topic: ${object.topic}`);
  return { script: object, prompt };
}
