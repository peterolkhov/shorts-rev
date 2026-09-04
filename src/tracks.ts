import { config } from "./config.js";

/**
 * A TRACK is the content domain — what the video is ABOUT and its tone. It's
 * separate from format (the visual style). The bandit picks a track per video,
 * so the channel can run high-RPM finance AND high-reach goofy entertainment,
 * and the coach learns which pulls (finance earns more per view; entertainment
 * reaches more people and grows subs faster — both help the business).
 */
export interface Track {
  id: string;
  label: string;
  domain: string; // the topic space the LLM writes in
  toneDirective: string; // voice/energy
  seedAngles: string[]; // starting angle ideas
  avoid: string[];
  seedHooks: string[]; // example hooks to match the energy of
  rpmNote: string;
}

export const TRACKS: Track[] = [
  {
    id: "finance",
    label: "Personal finance / investing",
    domain: config.niche,
    toneDirective:
      "Sharp, punchy, a little provocative — think a smart friend spilling a secret, NOT a lecture. One real number, an open loop, a mid-video 'here's the crazy part', and a genuine insight. High energy, zero boring windup.",
    seedAngles: [
      "counterintuitive money math that changes a decision",
      "a specific number most people get wrong (fees, taxes, compounding)",
      "a wealthy-people habit explained mechanically",
    ],
    avoid: ["generic 'save money' tips", "vague motivation with no number"],
    seedHooks: [
      "A $5 coffee isn't costing you $5 — over 40 years it's costing you $47,000. Here's the math.",
      "The 'safe' savings account is quietly losing you money every month. Let me prove it.",
      "Millionaires don't budget. They do the opposite — and it's why they pull away.",
    ],
    rpmNote: "high RPM ($0.15-0.45) — earns most per view",
  },
  {
    id: "entertainment",
    label: "Goofy / absurd everyday humor",
    domain:
      "goofy, absurd, relatable everyday humor and unhinged hot takes about ordinary life — the 'why you should never take your bald dad to an NBA game' energy. Oddly specific scenarios, exaggerated logic, universal relatable situations.",
    toneDirective:
      "Unhinged-but-friendly, punchy, comedic timing. Escalate the absurdity. Land a laugh, not a lesson. Keep it clean-ish and universally relatable.",
    seedAngles: [
      "oddly specific 'why you should never ___' scenarios",
      "exaggerated relatable everyday struggles taken to absurd conclusions",
      "unhinged hot takes about mundane things everyone secretly agrees with",
      "ranking absurd everyday situations nobody asked to rank",
    ],
    avoid: ["mean-spirited or punching-down jokes", "anything needing niche references", "actual misinformation"],
    seedHooks: [
      "Why you should never take your bald dad to an NBA game. I'm speaking from experience.",
      "There are three types of people at the gym and all of them are wrong.",
      "The most dangerous words in the English language: 'we should split the bill evenly.'",
    ],
    rpmNote: "low RPM ($0.01-0.05) but high reach — grows subs + feeds the algorithm",
  },
  {
    id: "hottakes",
    label: "Pop-culture hot takes & rage-bait",
    domain:
      "divisive but defensible opinions about internet culture, influencers, creators, trends, and modern life — the take that makes people SPRINT to the comments to agree or violently disagree. Unpopular opinions, deliberately controversial rankings/tier lists, calling overhyped things and influencer tropes overrated.",
    toneDirective:
      "Confident, provocative, a little smug. State the take like it's obvious fact everyone's too scared to say. Engineer replies — plant something people HAVE to argue with, then dare them to. Punchy, fast, no hedging.",
    seedAngles: [
      "AI and automation quietly coming for specific jobs/careers (this HITS a nerve — people have strong opinions on AI + job displacement → tons of comments; lean here often)",
      "which jobs AI actually replaces first vs. which are safe, stated as a spicy prediction people argue with",
      "the uncomfortable truth about a company automating away human workers (Klarna-style) and what it means for your paycheck",
      "unpopular opinions everyone secretly feels but won't admit",
      "ranking/tier-listing popular things in a deliberately spicy order",
      "why a beloved trend or influencer trope is actually overrated",
      "the thing everyone pretends to love but secretly doesn't",
    ],
    avoid: [
      "false factual claims about real people (that's defamation — keep opinions clearly opinions)",
      "attacking private individuals, or any hateful/harassing angle — punch at trends and tropes, not at people's identities",
      "naming a specific real person to insult; critique the behavior/trend instead",
    ],
    seedHooks: [
      "The company that just replaced 700 workers with AI is about to tell you it was 'for the customer.'",
      "Your job is safer from AI than you think, and the one you'd bet on is the first to go.",
      "Unpopular opinion: most 'that girl' morning routines are just unemployment with really good lighting.",
      "Ranking the most overrated things the internet pretends to love. Number one is going to start a war in my comments.",
    ],
    rpmNote: "low RPM, but rage-bait maximizes comments/shares/watch-time → max reach",
  },
  {
    id: "shareholder-letters",
    label: "Shareholder-letter & annual-report digests",
    domain:
      "digesting the big annual shareholder letters and reports — Warren Buffett's Berkshire letter, Jamie Dimon's JPMorgan letter, and similar — into ONE sharp, scripted takeaway. 'I read the 15-page letter so you don't have to; here's the one line that matters and what it means for your money.' Real quotes, real numbers, real interpretation.",
    toneDirective:
      "Authoritative but accessible — a smart analyst breaking down something important so a normal person gets it fast. Build it as a story: what they said → why it's surprising → what it means for you. Confident, clear, zero jargon left unexplained.",
    seedAngles: [
      "the single most important line in this year's Buffett letter and what it really means",
      "a warning Jamie Dimon buried in the JPMorgan letter that most people missed",
      "a number in an annual letter that quietly reveals a huge shift",
      "what a specific Buffett/Dimon quote actually tells you to do with your money",
    ],
    avoid: [
      "inventing or misquoting what they said — only real, verifiable quotes/numbers; if unsure of an exact figure, describe it without fabricating a number",
      "putting opinions in their mouth — separate their words from your interpretation",
      "dry summary with no takeaway — always land what it means for the viewer",
    ],
    seedHooks: [
      "Warren Buffett just quietly admitted something in his letter that should terrify every index-fund investor. Here's the line.",
      "Jamie Dimon buried a warning on page 9 of the JPMorgan letter. I read all 15 pages so you don't have to.",
      "One sentence in Buffett's letter explains why he's sitting on $180 billion in cash — and it's not what you think.",
    ],
    rpmNote: "high RPM ($0.15-0.45) — premium finance, authority-building",
  },
  {
    id: "current-events",
    label: "Current-events explainer / reaction (clickbait)",
    domain:
      "reacting to and explaining a notable recent event, headline, or thing a public figure or creator said — making it make sense fast with a clear take. 'Here's what actually happened, and here's the part nobody's saying.' Best when a specific event is provided as the topic seed.",
    toneDirective:
      "Fast, reactive, high-energy 'brain-rot' delivery — BUT still one coherent thread the viewer can follow (react → explain → take). MrBeast-clickbait framing on the hook. Punchy, current, opinionated.",
    seedAngles: [
      "explain a headline everyone's talking about and the money angle behind it",
      "'this creator/CEO said X' — lay out what they actually said, then your take on why it's right or wrong",
      "the real story behind a viral news moment, in 40 seconds",
    ],
    avoid: [
      "false or unverifiable claims about real people — that's defamation; state opinions clearly AS opinions and stick to what was actually said publicly",
      "fabricating quotes, events, or numbers — if you don't know it's true, don't assert it",
      "attacking someone's identity — critique the statement or idea, not the person",
    ],
    seedHooks: [
      "This might be the dumbest thing a billionaire has said all year — and people are actually falling for it.",
      "Everyone's mad about this headline for the wrong reason. Here's what actually happened.",
      "A creator with 10 million followers just gave the worst money advice I've ever heard. Let's break it down.",
    ],
    rpmNote: "mixed RPM — timely reactions spike reach; the finance angle keeps it monetizable",
  },
];

export function getTrack(id: string): Track {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}

/** Tracks need no API key, so availability = whatever's enabled in the playbook. */
export function availableTracks(enabled: string[]): Track[] {
  const ok = TRACKS.filter((t) => enabled.includes(t.id));
  return ok.length ? ok : [TRACKS[0]];
}
