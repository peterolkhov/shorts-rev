// Research-encoded strategy (July 2026). This is the ground truth the whole
// pipeline optimizes toward. Sources are in README.md.

import type { Playbook } from "./types.js";

/** RPM tiers — niche choice is ~10x more impactful than view count. */
export const RPM_TIERS = {
  top: {
    rpm: "$0.15–0.45",
    niches: [
      "personal finance & investing",
      "real estate",
      "business / SaaS",
      "B2B cybersecurity",
      "tax & money strategy",
    ],
  },
  mid: {
    rpm: "$0.06–0.18",
    niches: ["AI/tech tools", "careers & resumes", "home improvement"],
  },
  low: {
    rpm: "$0.01–0.05",
    niches: ["entertainment", "comedy", "gaming", "ai-animal"],
  },
};

/**
 * The hard rules every script/video must satisfy. These encode BOTH the
 * retention research and the July-2025 "inauthentic content" policy that
 * demonetizes templated, prompt-to-upload AI video.
 */
export const STRATEGY_RULES = `
IT MUST BE A REAL SCRIPT, NOT A PILE OF FACTS (this is the #1 rule):
The video has to be a coherent, followable STORY or ARGUMENT that a viewer can
track from start to finish — one thread, building. If a caption were removed the
viewer should still feel the throughline. Structure every script as three acts:
  1. SETUP (the hook + the situation): drop them into a specific, concrete scene
     or claim. Establish ONE question or tension the whole video will resolve.
  2. TURN (the escalation / the "here's the part nobody sees"): develop it with
     real detail — a number, a name, a step in the reasoning — that deepens the
     tension. This is the middle that most AI scripts skip; do NOT skip it.
  3. PAYOFF (the resolution + the button): land the answer the setup promised,
     then end on a fresh comment-bait line.
Each sentence must LOGICALLY FOLLOW the last — cause→effect, question→answer,
claim→proof. No disconnected fact-salad, no non-sequitur jumps. Read it back: if
it sounds like a person telling one story to a friend, it passes; if it sounds
like bullet points read aloud, rewrite it.

CLARITY (people must be able to FOLLOW ALONG):
- Introduce a name/term before you lean on it. Don't assume context.
- For finance: make hard material digestible — walk the ONE key number step by
  step so a smart adult "gets it" in 40 seconds. Explain, don't just assert.
- For entertainment/kids: simple, vivid, concrete language a 12-year-old tracks
  effortlessly. One clear escalating bit, not scattered randomness.

FORMAT & RETENTION (from 2026 data — NOTHING is allowed to be boring):
- Narrative beats lists — narrative retains 40-60% better. Tell ONE story/insight, don't list.
- Target 35-50s of tight narration (~95-135 spoken words). 50-60s Shorts complete best (~76%); never under 25s.
- HOOK (first 2s decide everything): use a curiosity gap ("Nobody talks about this…"), a contradiction ("I made more AFTER I stopped…"), or a shocking concrete number. Never "Did you know".
- OPEN LOOPS: plant a question early and pay it off late ("I'll show you the number in a sec — but first…"). Keep a reason-to-stay alive the whole way.
- MID-VIDEO RE-HOOK: around the 40% mark, hit a pattern interrupt line ("but here's the part that's actually insane…") so the retention curve doesn't sag.
- PACING: short sentences. Every ~2-3s something changes (a new beat, a turn, a reveal). No throat-clearing, no slow windups.
- END on a NEW comment-bait line — a question, a dare, or a divisive statement that makes people reply. NEVER restate, echo, or loop back to the hook/opening line — the ending must introduce something fresh (a twist, a challenge, or a "prove me wrong").

MONETIZATION / STAY-ALIVE (July-2025 inauthentic-content policy — this demonetizes farms):
- Every video needs a CREATIVE FINGERPRINT: a consistent editorial voice + original analysis, not just narrated facts.
- Add a genuine INSIGHT or interpretation the viewer couldn't get from a Wikipedia sentence. "Here's why that matters" beats "here's a fact".
- Never templated/interchangeable. The test: "Would a viewer recognize this as OUR channel's voice?"
- Claims must be TRUE and specific (real numbers, real names). Reputation is the monetizable asset.

VISUALS (support the script — don't drown it in flashing images):
- The brollQueries must FOLLOW THE SCRIPT: each visual beat illustrates the sentence it plays under, in order, so the images help the viewer follow the story. NOT random flashing stock.
- Prefer FEWER, more RELEVANT, longer-held shots over rapid unrelated churn. A viewer should understand what they're looking at.
- When the script names a real person/company/place, the visual should be THAT real thing (a real photo), not a generic AI abstraction.
- B-roll is a RETENTION layer, not the value. The original narration carries the transformative value that keeps you monetized. Captions are mandatory — most Shorts are watched muted.
`;

/** Default finance-lane playbook — the coach evolves this from real data. */
export function defaultPlaybook(): Playbook {
  return {
    updatedAt: new Date(0).toISOString(),
    hookGuidance:
      "Open a curiosity gap in the first 2 seconds — a concrete surprise or a claim that contradicts what people assume. Never 'Did you know'.",
    voice: { stability: 0.4, style: 0.4, speed: 1.2 }, // snappy, energetic delivery
    caption: {
      maxWords: 2, // fewer words = more rapid caption changes = flashier
      fillColor: "#FFFFFF",
      highlightColor: "#FFE600", // karaoke: the spoken word pops yellow
      strokeColor: "rgba(0,0,0,0.95)",
      yFraction: 0.6, // center hot-zone where eyes track
      fontScale: 1.0,
    },
    visual: { mode: "stock", segmentSeconds: 2.2 },
    targetLengthSec: 30, // punchy — shorter holds better
    exploreRate: 0.3,
    // All formats start enabled & equally weighted — the coach prunes/weights
    // them as retention data comes in. Formats missing their API key are
    // skipped automatically at draw time. (ai-cinematic is opt-in — pricey.)
    enabledFormats: [
      "finance-narration",
      "real-explainer",
      "ai-slideshow",
      "ai-brainrot",
      "gameplay-story",
    ],
    formatWeights: {
      "finance-narration": 1,
      "real-explainer": 1.5, // favor real, coherent, followable imagery
      "ai-slideshow": 1,
      "ai-brainrot": 1,
      "gameplay-story": 1,
      "ai-cinematic": 1,
    },
    // Both content tracks enabled. Finance earns more per view; entertainment
    // grows the channel. The coach reweights them as the data comes in.
    enabledTracks: [
      "finance",
      "entertainment",
      "hottakes",
      "shareholder-letters",
      "current-events",
    ],
    trackWeights: {
      finance: 1,
      entertainment: 1,
      hottakes: 1.5,
      "shareholder-letters": 1,
      "current-events": 1,
    },
    notes: "Seed playbook. Awaiting real performance data to tune.",
  };
}
