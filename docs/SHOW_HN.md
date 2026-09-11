# Launch posts

Copy-paste drafts. Replace the placeholders before posting:

- `[DEMO_VIDEO_URL]` — a public sample Short (YouTube / mux / Cloudflare Stream)
- `[CHANNEL_URL]` — the public demo channel, once it exists
- `[GIF_URL]` — optional: the looping `docs/demo.gif` once it is in the repo

Do not invent view counts, revenue, or channel size. This project is early.

Repo: https://github.com/peterolkhov/shorts-rev

---

## 1. Show HN (ready to paste)

**Title**

```
Show HN: Faceless YouTube Shorts that coach themselves from retention
```

**Body**

```
I got tired of AI-shorts tools that stop at “here is an mp4.” They never see
whether the hook held, so the fifth video is as random as the first.

shorts-rev is an MIT TypeScript pipeline that renders a faceless 1080×1920
Short (script → ElevenLabs → Pexels B-roll → karaoke captions → ffmpeg) and
then — after you upload — pulls retention/RPM and lets a coach LLM rewrite
the playbook (hooks, caption look, pacing, format weights, tracks).

Sample Short (replace when live): [DEMO_VIDEO_URL]
Demo channel (replace when live): [CHANNEL_URL]

Try a local render without YouTube OAuth (~$0.05–0.15 with Claude +
ElevenLabs + Pexels; cheaper if you skip Claude and use the canned script):

  git clone https://github.com/peterolkhov/shorts-rev
  cd shorts-rev && npm install
  cp .env.example .env   # ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, PEXELS_API_KEY
  npm run make -- --demo
  # → out/demo.mp4

Limitations, honestly: you still need those three keys for a voiced stock
Short; YouTube Data API OAuth for upload/analytics; ffmpeg on PATH. There is
no hosted app, no magic growth, and the coach is only as good as the
analytics you actually sync. Cross-posting to TikTok/Reels is optional and
key-gated.

Happy to hear what would make this actually usable on day one.
```

---

## 2. Indie Hackers (slightly longer)

**Title**

```
I open-sourced a faceless Shorts pipeline that rewrites its own playbook from retention
```

**Body**

```
Problem
Most “AI YouTube Shorts” products are a one-shot renderer. You get a vertical
video, post it, and the next run does not know that the hook died at second
two. The expensive part is not generating footage — it is learning what
keeps people from swiping.

What I built
shorts-rev (MIT, TypeScript) is a local CLI:

  ideate → tts → visuals → captions → assemble → upload → analytics → coach

Output is a faceless 1080×1920 Short. Captions are burned with canvas so any
ffmpeg works (no libass). Visuals default to Pexels stock; fal.ai and Pixabay
are optional formats the bandit can pick once those keys exist.

The wedge is the coach. Every render logs the exact params in ledger.json.
After a video is live, `npm run sync` pulls views / average view percentage /
RPM. `npm run coach` compares winners vs losers and rewrites playbook.json —
hook guidance, voice, captions, cut pace, which formats and tracks to favor.
It explores with a shrinking epsilon so you can tell which knob moved.

Cost
A stock-footage short is about $0.05–0.15 (Claude ~$0.01, ElevenLabs
~$0.02–0.10 and often free-tier, Pexels free, YouTube upload free). AI-video
formats cost more; `npm run doctor` prints an estimate per format.

How to try (no YouTube OAuth)
  git clone https://github.com/peterolkhov/shorts-rev
  cd shorts-rev && npm install
  cp .env.example .env
  npm run make -- --demo
  # out/demo.mp4

Minimum keys for a real voiced stock Short: Anthropic + ElevenLabs + Pexels.
YouTube client id/secret and `npm run auth` are only for upload + the coach
loop.

Demo (placeholders — replace before posting)
  Video: [DEMO_VIDEO_URL]
  Channel: [CHANNEL_URL]
  Repo: https://github.com/peterolkhov/shorts-rev

Honest limitations
- Not a SaaS. You run it on your machine.
- First useful video still needs API keys (the README is explicit).
- Coach quality depends on actually posting and syncing analytics.
- No claim that this will grow a channel. It is a closed loop around
  whatever you publish.
- Cross-post adapters exist for TikTok / IG / FB Reels but each platform
  has its own app review and token mess.

I am sharing this because I wanted the smallest path from “clone” to
“finished Short on disk,” then a real feedback loop — not another
undifferentiated generator. Feedback on the --demo path especially welcome.
```

---

## 3. Social variants (X / Reddit)

Lead with the video, then the repo. Swap in `[DEMO_VIDEO_URL]` (or attach the
mp4 / GIF) before posting. Do not pad with fake metrics.

### A — X / Twitter (output first)

```
[DEMO_VIDEO_URL]

Faceless 1080×1920 Short, one command, no YouTube OAuth to try.

MIT repo: https://github.com/peterolkhov/shorts-rev
npm run make -- --demo  →  out/demo.mp4
~$0.05–0.15 (Claude + ElevenLabs + Pexels). Coach loop learns from retention.
```

### B — X / Twitter (coach wedge)

```
[DEMO_VIDEO_URL]

Most AI-shorts tools stop at the mp4. This one logs the params, pulls
retention, and rewrites its own playbook.

https://github.com/peterolkhov/shorts-rev
```

### C — Reddit (r/SideProject / r/opensource)

**Title:** `Open-source faceless YouTube Shorts pipeline (self-improving coach, ~$0.05–0.15/video)`

```
[DEMO_VIDEO_URL]

I open-sourced shorts-rev: local TypeScript CLI that writes a script, voices
it, lays Pexels B-roll, burns karaoke captions, and assembles a 1080×1920
Short.

The part I actually care about: after you upload, it can pull retention/RPM
and have an LLM rewrite the playbook so the next video is not a dice roll.

Try without YouTube login:
git clone https://github.com/peterolkhov/shorts-rev
npm install && cp .env.example .env && npm run make -- --demo

Keys for a real voiced stock Short: Anthropic + ElevenLabs + Pexels.
Channel (when live): [CHANNEL_URL]

Not monetized, not a growth hack, MIT. Roast the --demo path if it is still
too much friction.
```

### D — X / Twitter (how to run)

```
[DEMO_VIDEO_URL]

npm i
cp .env.example .env
npm run make -- --demo

→ out/demo.mp4 (no OAuth)

https://github.com/peterolkhov/shorts-rev
```

### E — Reddit short (r/InternetIsBeautiful / r/CommandLine)

**Title:** `One command → faceless 1080×1920 YouTube Short (open source)`

```
[DEMO_VIDEO_URL]

Repo: https://github.com/peterolkhov/shorts-rev

`npm run make -- --demo` renders locally. Upload/coach is a separate step
once you add YouTube OAuth. Stock short is about $0.05–0.15. Demo channel:
[CHANNEL_URL]
```
