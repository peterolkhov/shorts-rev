import { config } from "./config.js";
import { log } from "./lib/util.js";
import { make, makeAndUpload, batch, post, cycle, crosspost } from "./pipeline.js";
import { authorize, deleteVideos } from "./steps/upload.js";
import { authorizeTiktok, describePublishers } from "./publishers/index.js";
import { syncAnalytics } from "./steps/analytics.js";
import { engageComments } from "./steps/comments.js";
import { recycleTakedown, repostDue } from "./steps/recycle.js";
import { recordSnapshot } from "./steps/snapshot.js";
import { spyTopHooks } from "./steps/spy.js";
import { coach } from "./coach.js";
import { doctor } from "./doctor.js";
import { loadLedger, score } from "./ledger.js";
import { loadPlaybook } from "./playbook.js";

const [cmd, ...rest] = process.argv.slice(2);
const seed = rest.filter((a) => !a.startsWith("-")).join(" ") || undefined;

function count(): number {
  const flag = rest.find((a) => a.startsWith("--n="));
  return flag ? parseInt(flag.slice(4), 10) : 3;
}

function flag(name: string): string | undefined {
  const f = rest.find((a) => a.startsWith(`--${name}=`));
  return f ? f.slice(name.length + 3) : undefined;
}

const makeOpts = { track: flag("track"), format: flag("format") };

async function stats() {
  const ledger = await loadLedger();
  const pb = await loadPlaybook();
  console.log(`\nPlaybook (updated ${pb.updatedAt}):`);
  console.log(`  tracks=${JSON.stringify(pb.trackWeights)}`);
  console.log(`  formats=${JSON.stringify(pb.formatWeights)}`);
  console.log(`  length=${pb.targetLengthSec}s explore=${pb.exploreRate}\n`);
  console.log(`${ledger.length} videos in ledger:`);
  for (const e of ledger.slice(-15)) {
    const p = e.performance;
    const s = score(e);
    const perf = p
      ? `${p.views}v ${p.avgViewPct.toFixed(0)}% $${p.rpm.toFixed(3)}rpm ${s ? "score=" + s.toFixed(2) : ""}`
      : e.youtubeId
        ? "uploaded, no analytics yet"
        : "local only";
    console.log(
      `  ${e.exploring ? "🔬" : "  "} ${(e.params.track ?? "?").padEnd(10)} ${(e.params.format ?? "?").padEnd(17)} ${e.title.slice(0, 28).padEnd(28)} ${perf}`,
    );
  }
}

async function main() {
  switch (cmd) {
    case "make":
      await make(seed, makeOpts);
      break;
    case "run":
      console.log(await makeAndUpload(seed));
      break;
    case "post": {
      // upload already-rendered videos. privacy via --privacy=public|unlisted|private
      const p = (flag("privacy") ?? "public") as "private" | "unlisted" | "public";
      const urls = await post(p);
      urls.forEach((u) => console.log(u));
      if (urls.length) console.log(`\nPosted ${urls.length} video(s) as ${p}.`);
      break;
    }
    case "batch":
      await batch(count());
      break;
    case "auth":
      await authorize();
      break;
    case "tiktok-auth": // one-time TikTok OAuth (Content Posting API)
      await authorizeTiktok();
      break;
    case "crosspost": {
      // fan already-rendered videos out to every platform in PLATFORMS
      const p = (flag("privacy") ?? "public") as "private" | "unlisted" | "public";
      await crosspost(p);
      break;
    }
    case "platforms": {
      // show which platforms are enabled + configured
      console.log(`\nPLATFORMS = ${config.platforms.join(", ")}\n`);
      for (const p of describePublishers()) {
        const state = !p.enabled
          ? "off (not in PLATFORMS)"
          : p.configured
            ? "✓ ready"
            : "✗ missing keys";
        console.log(
          `  ${p.name.padEnd(11)} ${state}${p.needsPublicUrl ? "  (needs R2 host)" : ""}`,
        );
      }
      console.log("\nSee SETUP-CROSSPOST.md for the per-platform setup.");
      break;
    }
    case "delete": // remove videos by id: delete <id> <id> ...
      await deleteVideos(rest.filter((a) => !a.startsWith("-")));
      break;
    case "sync": // pull retention/RPM from YouTube into the ledger
      await syncAnalytics();
      break;
    case "comments": // read + reply to comments. dry-run drafts unless --post
      await engageComments({ post: rest.includes("--post") });
      break;
    case "recycle": // find + take down one dead video (dry-run unless --live)
      await recycleTakedown(!rest.includes("--live"));
      break;
    case "snapshot": // record a dated monetization data point for the progression chart
      await recordSnapshot();
      break;
    case "spy": // pull top-performing finance Shorts from other channels → viral-hooks.json
      await spyTopHooks();
      break;
    case "tick": {
      // One scheduled beat. Fired at several candidate slots across the day; it
      // spreads ~MAX_DAILY posts over the remaining slots with randomness, so
      // post TIMES drift day-to-day (a deliberate experiment to learn if timing
      // matters). Still at most one upload per beat → throttle-safe. Also: prune
      // dead videos every beat, run the coach once/day, and answer comments.
      const SLOTS = [10, 12, 14, 16, 18, 20]; // candidate post hours — must match the launchd plist (dropped 8am: coach flagged it as the worst-performing hour)
      const MAX_DAILY = 5; // more shots-on-goal; drift picks which 5 of 6 slots fire (stays spaced, no bunching)
      const now = new Date();
      const sameDay = (d: string) => new Date(d).toDateString() === now.toDateString();

      const led = await loadLedger();
      const postedToday = led.filter((e) => e.youtubeId && sameDay(e.createdAt)).length;

      // Coach once per day, on the first beat that fires (robust to the Mac
      // sleeping through the 8am slot): trigger when the playbook is stale.
      const pb = await loadPlaybook();
      if (new Date(pb.updatedAt).toDateString() !== now.toDateString()) {
        await syncAnalytics().catch((e) => log("tick", `sync skipped: ${e.message}`));
        await spyTopHooks().catch((e) => log("tick", `spy skipped: ${e.message}`));
        await coach().catch((e) => log("tick", `coach skipped: ${e.message}`));
        await recordSnapshot().catch((e) => log("tick", `snapshot skipped: ${e.message}`));
      }

      await recycleTakedown(false).catch((e) => log("tick", `takedown skipped: ${e.message}`));

      // Drifted posting: spread the remaining posts over the remaining slots.
      const slotsLeft = Math.max(1, SLOTS.filter((h) => h >= now.getHours()).length);
      const need = MAX_DAILY - postedToday;
      const shouldPost = need > 0 && Math.random() < need / slotsLeft;
      if (shouldPost) {
        // FRESH content is the priority. A queued repost only sometimes claims the
        // slot (~35%), so dead-topic revivals trickle back in WITHOUT freezing out
        // new experiments. Falls back to fresh if no repost is due or it errors.
        const REPOST_CHANCE = 0.35;
        const repostUrl =
          Math.random() < REPOST_CHANCE
            ? await repostDue(make).catch((e) => {
                log("tick", `repost skipped: ${e.message}`);
                return null;
              })
            : null;
        console.log(repostUrl ?? (await makeAndUpload(seed)));
      } else {
        log("tick", `holding slot — ${postedToday}/${MAX_DAILY} posted today, ${slotsLeft} slots left (drift)`);
      }

      await engageComments({ post: true }).catch((e) => log("tick", `comments skipped: ${e.message}`));
      break;
    }
    case "coach": // let the LLM tune the playbook from performance
      await coach();
      break;
    case "loop": // the full self-improving cycle: sync -> coach -> post
      await syncAnalytics();
      await coach();
      console.log(await makeAndUpload(seed));
      break;
    case "cycle": {
      // sync -> coach -> post one finance + entertainment + hottakes + brainrot
      const p = (flag("privacy") ?? "public") as "private" | "unlisted" | "public";
      const urls = await cycle(p);
      urls.forEach((u) => console.log(u));
      break;
    }
    case "stats":
      await stats();
      break;
    case "doctor": // validate all keys cheaply + show cost per format
      await doctor();
      break;
    default:
      console.log(`shorts-rev — self-improving faceless Shorts pipeline

Niche: "${config.niche}"

  Build & post
    npm run make            build ONE short -> out/ (no upload)
    npm run make "angle"    steer the topic
    npm run batch -- --n=5  build 5 to review
    npm run run             build ONE and upload

  Cross-posting (YouTube + TikTok + Instagram + Facebook)
    npx tsx src/cli.ts platforms     show which platforms are configured
    npm run auth                     one-time YouTube OAuth
    npx tsx src/cli.ts tiktok-auth   one-time TikTok OAuth
    npx tsx src/cli.ts crosspost     fan rendered videos out to all platforms

  Self-improvement loop
    npx tsx src/cli.ts sync   pull retention/RPM into ledger.json
    npx tsx src/cli.ts coach  LLM tunes playbook.json from performance
    npx tsx src/cli.ts loop   sync -> coach -> post (the daily cron target)
    npx tsx src/cli.ts cycle  produce + cross-post one video per lane
    npx tsx src/cli.ts stats  show playbook + recent video performance

Flow: run 'cycle' daily. It learns what retains + earns and tunes itself,
then posts to every platform in PLATFORMS. See SETUP-CROSSPOST.md.`);
  }
}

main().catch((e) => {
  console.error("\n\x1b[31m✗\x1b[0m", e.message ?? e);
  process.exit(1);
});
