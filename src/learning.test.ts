import assert from "node:assert/strict";
import test from "node:test";
import { applyLearningGuards, attachEarlySignals, detectPlateau } from "./feedback.js";
import { formatReady, getFormat } from "./formats.js";
import { score } from "./ledger.js";
import { defaultPlaybook } from "./strategy.js";
import {
  claimNext,
  formatNewsSeed,
  mergeSeeds,
  parseFeed,
  seedFromItem,
  type NewsQueue,
  type NewsSeed,
} from "./steps/news.js";
import { summarizeComments } from "./steps/themes.js";
import type { LedgerEntry, Performance } from "./types.js";

function perf(over: Partial<Performance> & { views: number }): Performance {
  return {
    avgViewPct: 0,
    avgViewSec: 0,
    likes: 0,
    comments: 0,
    estRevenue: 0,
    rpm: 0,
    sampledAt: "2026-10-02T12:00:00.000Z",
    ...over,
  };
}

function entry(i: number, views: number, extra: Partial<Performance> = {}, format = "finance-narration", track = "finance"): LedgerEntry {
  return {
    id: `v${i}`,
    createdAt: new Date(Date.UTC(2026, 9, 1, i)).toISOString(),
    videoPath: `out/${i}.mp4`,
    exploring: false,
    title: `title ${i}`,
    hook: "hook",
    params: {
      topic: `topic ${i}`,
      track,
      format,
      voice: { stability: 0.4, style: 0.4, speed: 1.1 },
      caption: {
        maxWords: 2,
        fillColor: "#fff",
        highlightColor: "#ffe600",
        strokeColor: "#000",
        yFraction: 0.6,
        fontScale: 1,
      },
      visual: { mode: "stock", segmentSeconds: 2.2 },
      targetLengthSec: 32,
    },
    performance: perf({ views, ...extra }),
  };
}

test("early velocity changes score while retention and RPM are 0", () => {
  const fast = entry(1, 1000, { viewsPerHour: 800, likes: 40, comments: 5 });
  const slow = entry(2, 1000, { viewsPerHour: 20, likes: 40, comments: 5 });
  const fastScore = score(fast);
  const slowScore = score(slow);
  assert.ok(fastScore !== null && fastScore > 0);
  assert.ok(slowScore !== null && slowScore > 0);
  assert.ok(fastScore! > slowScore!);
  assert.equal(fast.performance!.avgViewPct, 0);
  assert.equal(fast.performance!.rpm, 0);

  const crawled = entry(3, 1000, { viewsPerHour: 20 });
  const earlyHit = entry(4, 1000, { viewsPerHour: 20, viewsAt1h: 900 });
  assert.ok(score(earlyHit)! > score(crawled)!);
  assert.equal(score(entry(5, 10, { viewsPerHour: 500 })), null);
});

test("sync stamps views/hour and keeps the 1h snapshot", () => {
  const createdAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const first = attachEarlySignals(
    { createdAt },
    perf({ views: 400, likes: 8, comments: 1, sampledAt: new Date().toISOString() }),
  );
  assert.equal(first.viewsAt1h, 400);
  assert.equal(first.avgViewPct, 0);
  assert.equal(first.rpm, 0);
  assert.ok((first.viewsPerHour ?? 0) > 200);
  assert.ok((first.engagementRate ?? 0) > 0);

  const dayLater = attachEarlySignals(
    { createdAt, performance: first },
    perf({ views: 1100, likes: 20, comments: 3, sampledAt: new Date().toISOString() }),
    Date.now() + 20 * 36e5,
  );
  assert.equal(dayLater.viewsAt1h, 400);
  assert.equal(dayLater.viewsAt24h, 1100);
});

test("a ~1k cluster raises exploreRate and diversifies formats and tracks", () => {
  const views = [980, 1020, 990, 1010, 1005, 970];
  const ledger = views.map((v, i) => entry(i, v));
  const report = detectPlateau(ledger);
  assert.equal(report.plateaued, true);
  assert.ok(report.outlierRatio < 2);

  const pb = defaultPlaybook();
  pb.exploreRate = 0.3;
  pb.enabledFormats = ["finance-narration"];
  pb.formatWeights = { "finance-narration": 5 };
  pb.enabledTracks = ["finance"];
  pb.trackWeights = { finance: 5 };
  const { playbook } = applyLearningGuards(pb, ledger);
  assert.ok(playbook.exploreRate >= 0.6);
  assert.ok(playbook.exploreRate <= 0.75);
  assert.ok(playbook.enabledFormats.includes("ugc-talking-head"));
  assert.ok(playbook.enabledFormats.includes("rant-mode"));
  assert.ok(playbook.enabledTracks.includes("current-events"));
  assert.ok(playbook.formatWeights["ugc-talking-head"] > playbook.formatWeights["finance-narration"]);
  assert.ok(playbook.trackWeights["current-events"] > playbook.trackWeights.finance);
  assert.match(playbook.notes, /Plateau response:/);
});

test("a 2x outlier is not treated as a plateau", () => {
  const ledger = [1000, 1000, 1000, 1000, 2500].map((v, i) => entry(i, v));
  const report = detectPlateau(ledger);
  assert.equal(report.plateaued, false);
  const pb = defaultPlaybook();
  pb.exploreRate = 0.3;
  const { playbook } = applyLearningGuards(pb, ledger);
  assert.equal(playbook.exploreRate, 0.3);
});

test("comment mining keeps real questions", () => {
  const summary = summarizeComments([
    { text: "how do I start investing with $50?" },
    { text: "wait how do I start investing though" },
    { text: "what about taxes on this?" },
    { text: "nice" },
  ]);
  const blob = JSON.stringify(summary);
  assert.match(blob, /invest/i);
  assert.match(blob, /tax/i);
  assert.match(summary.forWriter, /paraphrase/i);
  assert.match(summarizeComments([]).forWriter, /No recurring/);
});

const RSS = `<?xml version="1.0"?>
<rss><channel>
<item>
  <title><![CDATA[Fed holds rates - Reuters]]></title>
  <link>https://news.google.com/rss/articles/abc</link>
  <pubDate>Thu, 01 Oct 2026 15:04:00 GMT</pubDate>
  <description><![CDATA[<p>The Federal Reserve left interest rates unchanged on Thursday.</p>]]></description>
  <source url="https://www.reuters.com">Reuters</source>
</item>
<item>
  <title>Fed holds rates - AP</title>
  <link>https://example.com/ap-fed</link>
  <pubDate>Thu, 01 Oct 2026 16:00:00 GMT</pubDate>
  <description>The Federal Reserve left interest rates unchanged.</description>
</item>
<item>
  <title>Local team wins the cup</title>
  <link>https://example.com/sports</link>
  <pubDate>Thu, 01 Oct 2026 16:00:00 GMT</pubDate>
  <description>A thrilling final went to extra time.</description>
</item>
</channel></rss>`;

test("RSS parse dedupes headlines, drops off-niche, and ages out", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const items = parseFeed(RSS, "Google News");
  assert.equal(items.length, 3);
  const seeds = items.map((item) => seedFromItem(item, now)).filter((s): s is NewsSeed => !!s);
  assert.equal(seeds.length, 2);
  assert.equal(seeds[0].id, seeds[1].id);
  const merged = mergeSeeds([], seeds, now, 72);
  assert.equal(merged.length, 1);
  assert.match(merged[0].summary, /Federal Reserve/);
  assert.equal(merged[0].url.startsWith("http"), true);

  const stale: NewsSeed = {
    ...merged[0],
    id: "stale-old",
    headline: "Old jobs report shows hiring slowed",
    publishedAt: new Date(now - 10 * 864e5).toISOString(),
  };
  const aged = mergeSeeds([stale], [], now, 72);
  assert.equal(aged.find((s) => s.id === "stale-old"), undefined);

  const queue: NewsQueue = { updatedAt: new Date(now).toISOString(), seeds: merged };
  const first = claimNext(queue, now, 72);
  assert.ok(first.seed);
  assert.match(formatNewsSeed(first.seed!), /NEWS SEED/);
  assert.match(formatNewsSeed(first.seed!), /HEADLINE: Fed holds rates/);
  assert.match(formatNewsSeed(first.seed!), /^[\s\S]*URL: https:\/\//);
  const second = claimNext(first.queue, now, 72);
  assert.equal(second.seed, null);
});

test("UGC format is selectable with FAL or HeyGen and hidden with neither", () => {
  const fmt = getFormat("ugc-talking-head");
  const prevFal = process.env.FAL_KEY;
  const prevHey = process.env.HEYGEN_API_KEY;
  delete process.env.FAL_KEY;
  delete process.env.HEYGEN_API_KEY;
  assert.equal(formatReady(fmt), false);
  process.env.FAL_KEY = "test-key";
  assert.equal(formatReady(fmt), true);
  delete process.env.FAL_KEY;
  process.env.HEYGEN_API_KEY = "test-key";
  assert.equal(formatReady(fmt), true);
  if (prevFal === undefined) delete process.env.FAL_KEY;
  else process.env.FAL_KEY = prevFal;
  if (prevHey === undefined) delete process.env.HEYGEN_API_KEY;
  else process.env.HEYGEN_API_KEY = prevHey;
  assert.ok(defaultPlaybook().enabledFormats.includes("ugc-talking-head"));
});
