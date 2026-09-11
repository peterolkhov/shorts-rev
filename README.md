# shorts-rev

**One command → a faceless 1080×1920 YouTube Short.** Then a coach loop reads
retention and revenue and rewrites the playbook so the next one is better.

That loop is the wedge: most AI-shorts tools stop at “render an mp4”. This one
keeps the exact params that produced each video, pulls analytics, and tunes
hooks, captions, pacing, format weights, and tracks from what actually held
viewers.

```
ideate → tts → visuals → captions → assemble → upload → analytics → coach → (better) ideate …
```

Captions are burned in-process with `@napi-rs/canvas`, so any ffmpeg build
works — no `drawtext` or `libass` setup.

## Demo

![Faceless 1080×1920 YouTube Short produced by one command](docs/demo.gif)

*one command → finished Short*

Drop a looping GIF at `docs/demo.gif` (or an mp4 at `examples/demo.mp4`) once
you have a public sample. Until then, render your own:

```bash
npm install
cp .env.example .env   # fill what's available
npm run make -- --demo
# → writes out/demo.mp4 — no YouTube OAuth
```

## Minimum keys to first video

You do **not** need YouTube OAuth to get a finished Short.

| Goal | Keys |
|------|------|
| **First video** (`npm run make -- --demo`) | `ANTHROPIC_API_KEY` + `ELEVENLABS_API_KEY` + `PEXELS_API_KEY` |
| Full upload + analytics + coach | those three **plus** `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` and `npm run auth` |

`--demo` forces the cheap stock path (Pexels), skips upload, and writes
`out/demo.mp4`. If a key is missing it degrades instead of hanging on OAuth:

- no Claude → canned demo script
- no ElevenLabs → silent stub audio (captions still burn)
- no Pexels → generated title-card clips (no stock binaries shipped)

A voiced stock Short needs ElevenLabs + Pexels. Run `npm run doctor` to see
**demo readiness** vs **full-run** (YouTube) readiness.

Where to get keys: [Anthropic](https://console.anthropic.com),
[ElevenLabs](https://elevenlabs.io), [Pexels API](https://www.pexels.com/api/).
Claude is ~$0.01/script; ElevenLabs is often free-tier; Pexels is free.

## What it does

- **Writes scripts** with an LLM, tuned for a specific niche and content track.
- **Voices them** with ElevenLabs word-level timestamps.
- **Fetches or generates visuals** from Pexels, Pixabay, or fal.ai.
- **Burns karaoke-style captions** with per-word highlighting.
- **Assembles a 1080×1920 mp4** with B-roll, SFX, and optional background music.
- **Uploads to YouTube** via OAuth and the YouTube Data API.
- **Pulls analytics** (views, retention, RPM) and feeds them to a coach LLM.
- **Tunes its own playbook**: the coach rewrites `playbook.json` with better
  hook guidance, caption style, pacing, format weights, and track weights.
- **Cross-posts** the same render to TikTok, Instagram Reels, and Facebook Reels
  when configured.

## Quick start (full channel)

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Copy and fill the environment file**
   ```bash
   cp .env.example .env
   ```
   First video: `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `PEXELS_API_KEY`.
   Upload later: `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`.
   See `.env.example` for the full list and where to get each key.

3. **Check your setup**
   ```bash
   npm run doctor
   ```
   Demo keys and YouTube auth are listed separately.

4. **Render one Short locally** (no upload)
   ```bash
   npm run make -- --demo
   ```
   The finished video is `out/demo.mp4`. `npm run make` (no flag) also renders
   locally but follows the playbook format bandit and will refuse if a chosen
   format’s keys are missing.

5. **Authorize YouTube once** (only when you want to upload)
   ```bash
   npm run auth
   ```
   This opens a browser for OAuth and saves a refresh token to
   `youtube-token.json` (already gitignored).

6. **Render and upload**
   ```bash
   YOUTUBE_PRIVACY=public npm run run
   ```
   Defaults to `private` so you can test before going live.

## CLI reference

```bash
npm run make -- --demo  # first Short → out/demo.mp4 (no YouTube OAuth)
npm run make            # render one Short to out/
npm run make "angle"    # steer the topic
npm run batch -- --n=5  # render 5 for review
npm run run             # render + upload one

npm run auth            # one-time YouTube OAuth
npm run tiktok-auth     # one-time TikTok OAuth (optional)
npm run platforms       # show which platforms are configured

npm run sync            # pull views/retention/RPM into ledger.json
npm run coach           # LLM rewrites playbook.json from performance
npm run loop            # sync → coach → post one
npm run cycle           # produce + cross-post one video per lane
npm run tick            # one autonomous beat (sync, coach, post, comments)

npm run stats           # show playbook + recent performance
npm run spy             # refresh viral-hook intelligence
npm run doctor          # demo vs full-run keys + cost per format
```

## Visual formats

The bandit picks a format per video; the coach learns which retains best.
A format is only chosen if its required API key is present. `--demo` always
uses `finance-narration` (Pexels stock).

| Format | Visuals | Provider | Needs |
|----|----|----|----|
| `finance-narration` | stock B-roll | Pexels | `PEXELS_API_KEY` |
| `human-real` | real human stock footage | Pexels | `PEXELS_API_KEY` |
| `money-story` | side-hustle / story stock clips | Pexels | `PEXELS_API_KEY` |
| `rant-mode` | raw rant energy with B&W grade | Pexels | `PEXELS_API_KEY` |
| `ai-brainrot` | fast real stock with brainrot captions | Pexels | `PEXELS_API_KEY` |
| `real-explainer` | documentary-style AI concept images | fal.ai | `FAL_KEY` |
| `ai-slideshow` | AI images + Ken Burns motion | fal.ai | `FAL_KEY` |
| `gameplay-story` | royalty-free gameplay loop | Pixabay | `PIXABAY_API_KEY` |
| `ai-cinematic` | AI text-to-video (premium) | fal.ai | `FAL_KEY` |

## How the self-improvement works

Every video records the exact params that produced it in `ledger.json`. After a
video is live, `npm run sync` pulls retention and RPM from YouTube Analytics. The
`coach` compares winners against losers and rewrites `playbook.json` — voice
cadence, caption look, cut pace, target length, hook guidance, and which formats
and tracks to favor.

It runs as a **bandit**: most videos exploit the current best playbook; roughly
`exploreRate` (which shrinks as data grows) perturb one knob so the coach can tell
what actually moved the needle. Before the channel is monetized, the scorer
optimizes for retention and engagement; once revenue flows, RPM is folded in.

## Cross-posting

YouTube, TikTok, Instagram Reels, and Facebook Reels are supported. Each
platform is skipped unless its keys are configured. See
[`SETUP-CROSSPOST.md`](./SETUP-CROSSPOST.md) for one-time setup.

## Automation

- **macOS launchd**: see [`scheduler/README.md`](./scheduler/README.md) for a
  template plist and runner script.
- **Linux / cron**: one line is enough:
  ```bash
  0 16 * * * cd /path/to/shorts-rev && YOUTUBE_PRIVACY=public npm run cycle
  ```

## Cost per video

Roughly **$0.05–0.15** for a stock-footage short:

- Script (Claude): ~$0.01
- ElevenLabs voice: ~$0.02–0.10 (often free-tier)
- Pexels / Pixabay: free
- YouTube upload: free

AI-image and AI-video formats cost more; run `npm run doctor` to see an estimate
for each format with your current keys.

## Files worth editing

- `src/config.ts` — resolution, default voice, model, paths.
- `src/strategy.ts` — the seed playbook and non-negotiable strategy rules.
- `src/steps/ideate.ts` — the scriptwriting prompt. Highest-leverage file.
- `src/coach.ts` — how the LLM interprets performance and moves the playbook.
- `src/ledger.ts` — the `score()` function used to rank videos.

## Security and data

- `.env`, `youtube-token.json`, `tiktok-token.json`, and all runtime data files
  (`ledger.json`, `playbook.json`, `monetization-snapshots.json`,
  `comment-replies.json`, `repost-queue.json`, `viral-hooks.json`) are
  **gitignored by default**. Do not commit them.
- Review `.env.example` before sharing the repo; no secrets should be in source.
- Optional `gameplay/` and `music/` directories and `assets/` are for your own
  licensed media. Do not commit copyrighted or trademarked images.

## Customizing the niche

Change `NICHE` in `.env`. The default seed playbook targets personal finance,
but the format/track system works for any high-retention Shorts niche. Edit
`src/strategy.ts` and the track definitions in `src/tracks.ts` to match your
content.

## Sharing / Contributing

Ready-to-paste **Show HN**, Indie Hackers, and social posts:
[`docs/SHOW_HN.md`](./docs/SHOW_HN.md).

Issues and PRs welcome. Please don’t commit `.env`, OAuth tokens, or `out/`
renders.

## License

MIT — see [`LICENSE`](./LICENSE).
