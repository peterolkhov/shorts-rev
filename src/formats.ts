import type { Provider } from "./providers.js";
import type { CaptionStyle } from "./types.js";

/**
 * A content FORMAT is a full template: which visual provider, what the script
 * should sound like, the look of generated visuals, caption treatment, and pace.
 * The bandit picks a format per video; the coach learns which one retains best.
 */
export interface Format {
  id: string;
  label: string;
  provider: Provider;
  requires: string[]; // env vars that must be set to use this format
  scriptDirective: string; // shapes the ideate prompt's tone
  visualPromptStyle: string; // look for AI-generated visuals
  caption: Partial<CaptionStyle>; // overrides on top of the playbook caption
  clipSeconds: number; // cut pace
  footageFilter?: string; // FOOTAGE_FILTERS key — a signature grade/LUT on the B-roll
}

export const FORMATS: Format[] = [
  {
    id: "finance-narration",
    label: "Stock-footage finance explainer",
    provider: "stock",
    requires: ["PEXELS_API_KEY"],
    scriptDirective:
      "Authoritative but conversational. One insight, one concrete number, show the reasoning.",
    visualPromptStyle: "",
    caption: { maxWords: 2, yFraction: 0.6 },
    clipSeconds: 2.3,
  },
  {
    id: "ai-slideshow",
    label: "AI-image slideshow",
    provider: "ai-image",
    requires: ["FAL_KEY"],
    scriptDirective:
      "Explainer tone. Each sentence maps to ONE vivid, concrete visual concept so the images land.",
    visualPromptStyle: "clean cinematic editorial illustration, rich color",
    caption: { maxWords: 2, yFraction: 0.62 },
    clipSeconds: 2.2,
  },
  {
    id: "ai-brainrot",
    label: "Brainrot (pop-culture chaos, REAL footage)",
    provider: "stock",
    requires: ["PEXELS_API_KEY"],
    scriptDirective:
      "Fast, punchy, slightly unhinged BRAINROT energy with a pop-culture vibe — very short sentences, chaotic meme-brain pacing, a shocking-but-TRUE money hook. Accurate facts, deranged delivery. CRUCIAL: every brollQuery is a REAL, FILMABLE human/scene that stock footage actually has (e.g. 'person scrolling phone fast', 'cash flying in the air', 'someone stressed at a laptop', 'crowd rushing through a station', 'hands ripping open bills') — chaotic REAL clips, never abstract concepts or symbols.",
    visualPromptStyle: "",
    caption: { maxWords: 1, yFraction: 0.5, fontScale: 1.18, highlightColor: "#00FF66", boxColor: "#FF00E5", boxTextColor: "#FFFFFF", strokeColor: "rgba(0,0,0,0.98)" },
    clipSeconds: 1.4,
  },
  {
    id: "human-real",
    label: "Real human footage (stock video, less AI-y)",
    provider: "stock",
    requires: ["PEXELS_API_KEY"],
    scriptDirective:
      "Warm, personable, like a real person talking straight to camera — conversational, relatable, a little imperfect. CRUCIAL: every brollQuery must be a REAL, FILMABLE HUMAN SCENE that stock footage will actually have (e.g. 'young woman shocked looking at phone', 'man counting cash on table', 'people rushing through a train station', 'hands typing on laptop at night') — NOT abstract concepts, charts, or symbols. Concrete human moments only.",
    visualPromptStyle: "",
    caption: { maxWords: 2, yFraction: 0.62 },
    clipSeconds: 2.4,
  },
  {
    id: "real-explainer",
    label: "Explainer (real photos of names + AI concept visuals)",
    provider: "real-image",
    requires: ["FAL_KEY"], // AI images are the workhorse; Wikimedia + stock need no/other keys
    scriptDirective:
      "A clear, scripted explainer that walks through ONE idea step by step so the viewer follows along. Name the real people, companies, and places involved so real photos can illustrate the story. Digestible, authoritative, one coherent thread.",
    visualPromptStyle: "clean modern documentary photograph, real scene, rich natural color, cinematic lighting",
    caption: { maxWords: 2, yFraction: 0.62 },
    clipSeconds: 3.0, // hold each visual so it reads, not flashing
  },
  {
    id: "gameplay-story",
    label: "Royalty-free gameplay + story (strike-safe brainrot)",
    provider: "pixabay-gameplay",
    requires: ["PIXABAY_API_KEY"],
    scriptDirective:
      "Tell it as a gripping 'story time' — a surprising money story or scenario with a twist. Conversational, second person, keeps them waiting for the payoff.",
    visualPromptStyle: "",
    caption: { maxWords: 2, yFraction: 0.78 },
    clipSeconds: 4.0,
  },
  {
    id: "ai-cinematic",
    label: "AI text-to-video (premium)",
    provider: "ai-video",
    requires: ["FAL_KEY"],
    scriptDirective:
      "Cinematic, dramatic narration. Each line evokes one vivid, filmable moment.",
    visualPromptStyle: "cinematic film still, dramatic lighting, shallow depth of field",
    caption: { maxWords: 2, yFraction: 0.62 },
    clipSeconds: 3.5,
  },
  // ── RADICAL EXPERIMENTS ── deliberately break the slideshow-story mold: raw
  // energy, giant/clashing captions, fast cuts, unconventional structure. These
  // are the "do something crazy when views plateau" treatments.
  {
    id: "rant-mode",
    label: "Unscripted rant (raw, off-the-cuff energy)",
    provider: "stock",
    requires: ["PEXELS_API_KEY"],
    scriptDirective:
      "This is NOT a polished explainer — it's a RAW, off-the-cuff RANT, like a real person who just got fired up talking straight into their phone. Ramble a little, interrupt yourself, use casual filler ('ok so', 'honestly', 'nobody talks about this', 'I'm telling you right now'). Get genuinely worked up about ONE money thing that's unfair, dumb, or a scam. Punchy, imperfect, opinionated — a real hot take, NOT a lecture, NOT a clean 3-act structure. Every brollQuery is a real, filmable HUMAN moment.",
    visualPromptStyle: "",
    // gritty B&W footage + a red word-box: reads like a raw, urgent call-out
    caption: { maxWords: 1, fontScale: 1.55, yFraction: 0.5, boxColor: "#FF2D2D", boxTextColor: "#FFFFFF", highlightColor: "#FFFFFF", fillColor: "#FFFFFF", strokeColor: "rgba(0,0,0,0.98)" },
    clipSeconds: 1.3,
    footageFilter: "noir",
  },
  {
    id: "rapid-list",
    label: "Rapid-fire list (high-stimulation countdown)",
    provider: "ai-image",
    requires: ["FAL_KEY"],
    scriptDirective:
      "A RAPID-FIRE LIST with countdown energy — e.g. '5 money traps quietly draining your paycheck' or '3 things broke people waste money on that rich people never do'. Blitz through each item in ONE punchy sentence, zero fluff, building to the wildest/most surprising one LAST. Fast, confident, a little chaotic. Each brollQuery is ONE bold, concrete image for that item.",
    visualPromptStyle: "bold high-contrast graphic, punchy saturated color, dynamic, meme-adjacent, high clarity",
    // hyper-saturated footage + black word-box with neon text: loud, kinetic
    caption: { maxWords: 1, fontScale: 1.5, yFraction: 0.44, boxColor: "#000000", boxTextColor: "#FFEE00", highlightColor: "#FFEE00", fillColor: "#FFFFFF", strokeColor: "rgba(0,0,0,0.98)" },
    clipSeconds: 0.9,
    footageFilter: "punch",
  },
  {
    id: "meme-chaos",
    label: "Absurdist meme-chaos (huge top text, surreal visuals)",
    provider: "ai-image",
    requires: ["FAL_KEY"],
    scriptDirective:
      "Absurdist, funny, brainrot-meme energy carrying a REAL money truth. Short, surreal, exaggerated — narration is minimal and punchy; the HUGE on-screen text does the heavy lifting. Think unhinged internet humor with a genuine financial lesson buried in the chaos. Keep every fact TRUE, but the delivery is deranged and hilarious.",
    visualPromptStyle: "surreal absurdist meme, hyper-saturated, chaotic dreamlike collage, exaggerated proportions, internet-core, deep-fried aesthetic",
    // top-positioned huge text + VHS grain: unhinged internet-core
    caption: { maxWords: 2, fontScale: 1.35, yFraction: 0.24, boxColor: "#7B2DFF", boxTextColor: "#FFFFFF", highlightColor: "#00FF66", fillColor: "#FFFFFF", strokeColor: "rgba(0,0,0,0.98)" },
    clipSeconds: 1.0,
    footageFilter: "vhs",
  },
  {
    id: "money-story",
    label: "Money story / side-hustle reveal (viral curiosity format)",
    provider: "stock",
    requires: ["PEXELS_API_KEY"],
    scriptDirective:
      "Tell a WILD money STORY like the viral 'side hustle reveal' videos crushing Shorts right now (millions of views). HOOK: a SPECIFIC surprising person doing something unexpected/absurd for money + a SHOCKING dollar number — e.g. 'This 24-year-old makes $9,000 a month renting out his driveway.' Then: how it actually works, the twist/kicker, end on comment-bait. Curiosity and DRAMA, never a lecture. Ground it in a REAL, plausible money mechanic (a legit side hustle, arbitrage, or loophole) so every claim is true — just told like a jaw-dropping story. Every brollQuery is a real, filmable HUMAN scene (a person doing the thing, counting cash, on a laptop, a driveway/garage/phone).",
    visualPromptStyle: "",
    // bold money-green word-box — reads 'cash/hustle'
    caption: { maxWords: 1, fontScale: 1.4, yFraction: 0.5, boxColor: "#00B84D", boxTextColor: "#FFFFFF", highlightColor: "#00E676", fillColor: "#FFFFFF", strokeColor: "rgba(0,0,0,0.98)" },
    clipSeconds: 2.2,
  },
];

export function getFormat(id: string): Format {
  return FORMATS.find((f) => f.id === id) ?? FORMATS[0];
}

/** Formats that are both enabled in the playbook AND have their keys present. */
export function availableFormats(enabled: string[]): Format[] {
  const ok = FORMATS.filter(
    (f) => enabled.includes(f.id) && f.requires.every((k) => !!process.env[k]),
  );
  // Always keep at least stock if its key exists, so the pipeline never stalls.
  if (ok.length) return ok;
  return FORMATS.filter(
    (f) => f.id === "finance-narration" && process.env.PEXELS_API_KEY,
  );
}
