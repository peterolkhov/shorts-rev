import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { config } from "../config.js";
import { log } from "../lib/util.js";

export interface NewsSeed {
  id: string;
  headline: string;
  url: string;
  /** Feed text only. Empty-ish summaries stay empty — scripts must not fill gaps. */
  summary: string;
  source: string;
  publishedAt: string;
  fetchedAt: string;
  usedAt?: string;
}

export interface NewsQueue {
  updatedAt: string;
  seeds: NewsSeed[];
}

export interface RssItem {
  title: string;
  url: string;
  summary: string;
  publishedAt: string;
  source: string;
}

const QUEUE_PATH = path.join(config.root, "news-seeds.json");

const NICHE =
  /\b(financ|money|invest|stock|shares|market|econom|job|layoff|hiring|wage|salary|ai|artificial intelligence|automat|robot|bank|fed|federal reserve|inflation|recession|startup|business|tax|debt|crypto|billion|ceo|worker|labor|labour|unemploy|interest rate|mortgage|rent|consumer|trade|tariff|ipo|earnings)\b/i;

const FEEDS: { source: string; url: string }[] = [
  {
    source: "Google News",
    url:
      "https://news.google.com/rss/search?q=" +
      encodeURIComponent("(personal finance OR investing OR inflation OR mortgage OR interest rates) when:2d") +
      "&hl=en-US&gl=US&ceid=US:en",
  },
  {
    source: "Google News",
    url:
      "https://news.google.com/rss/search?q=" +
      encodeURIComponent('(AI jobs OR layoffs OR "hiring freeze" OR automation OR "tech layoffs") when:2d') +
      "&hl=en-US&gl=US&ceid=US:en",
  },
  {
    source: "Google News / Reuters",
    url:
      "https://news.google.com/rss/search?q=" +
      encodeURIComponent("site:reuters.com (markets OR economy OR Federal Reserve OR jobs) when:3d") +
      "&hl=en-US&gl=US&ceid=US:en",
  },
  {
    source: "Google News / AP",
    url:
      "https://news.google.com/rss/search?q=" +
      encodeURIComponent("site:apnews.com (economy OR jobs OR inflation OR Federal Reserve) when:3d") +
      "&hl=en-US&gl=US&ceid=US:en",
  },
  { source: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { source: "NPR Business", url: "https://feeds.npr.org/1006/rss.xml" },
];

export function isNiche(text: string): boolean {
  return NICHE.test(text);
}

export function normalizeHeadline(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+[-|–—]\s+[^-|–—]+$/, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function seedId(headline: string): string {
  return createHash("sha1").update(normalizeHeadline(headline)).digest("hex").slice(0, 12);
}

function decodeXml(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textTag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeXml(m[1]) : "";
}

function atomLink(block: string): string {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)];
  let fallback = "";
  for (const l of links) {
    const href = /href=["']([^"']+)["']/i.exec(l[1])?.[1];
    if (!href) continue;
    const rel = /rel=["']([^"']+)["']/i.exec(l[1])?.[1] ?? "alternate";
    const url = decodeXml(href);
    if (!fallback) fallback = url;
    if (rel === "alternate" && url.startsWith("http")) return url;
  }
  return fallback.startsWith("http") ? fallback : "";
}

function toIso(raw: string): string {
  if (!raw) return "";
  const t = Date.parse(raw);
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

function summaryFrom(title: string, description: string, source: string): string {
  const stripped = description.replace(/\s+/g, " ").trim();
  const withoutTitle = stripped.replace(title, "").trim();
  const body = withoutTitle.length >= 40 ? withoutTitle : stripped.length >= 40 ? stripped : "";
  if (!body) return source ? `Reported by ${source}.` : "";
  return body.slice(0, 320);
}

/** Minimal RSS + Atom parser. No dependency — feeds are simple. */
export function parseFeed(xml: string, sourceLabel: string): RssItem[] {
  const chunks = xml.split(/<item\b|<entry\b/i).slice(1);
  const items: RssItem[] = [];
  for (const raw of chunks) {
    const block = raw.split(/<\/item>|<\/entry>/i)[0] ?? raw;
    const title = textTag(block, "title");
    if (!title) continue;
    const linkText = textTag(block, "link");
    const url = (linkText.startsWith("http") ? linkText : "") || atomLink(block);
    if (!url.startsWith("http")) continue;
    const published =
      textTag(block, "pubDate") || textTag(block, "published") || textTag(block, "updated");
    const description =
      textTag(block, "description") || textTag(block, "summary") || textTag(block, "content");
    const source = textTag(block, "source") || sourceLabel;
    items.push({
      title,
      url,
      summary: summaryFrom(title, description, source || sourceLabel),
      publishedAt: toIso(published),
      source: source || sourceLabel,
    });
  }
  return items;
}

export function seedFromItem(item: RssItem, now = Date.now()): NewsSeed | null {
  if (!isNiche(`${item.title} ${item.summary}`)) return null;
  return {
    id: seedId(item.title),
    headline: item.title.trim(),
    url: item.url,
    summary: item.summary,
    source: item.source,
    publishedAt: item.publishedAt || new Date(now).toISOString(),
    fetchedAt: new Date(now).toISOString(),
  };
}

export function mergeSeeds(
  existing: NewsSeed[],
  incoming: NewsSeed[],
  now = Date.now(),
  maxAgeHours = config.news.maxAgeHours,
): NewsSeed[] {
  const byId = new Map<string, NewsSeed>();
  for (const s of existing) byId.set(s.id, s);
  for (const s of incoming) {
    const prev = byId.get(s.id);
    if (prev) {
      byId.set(s.id, {
        ...s,
        usedAt: prev.usedAt,
        fetchedAt: prev.fetchedAt,
      });
    } else {
      byId.set(s.id, s);
    }
  }
  const maxAgeMs = maxAgeHours * 36e5;
  const keepUsedMs = 14 * 864e5;
  const kept = [...byId.values()].filter((s) => {
    const published = new Date(s.publishedAt).getTime();
    if (Number.isNaN(published)) return false;
    if (s.usedAt) return now - new Date(s.usedAt).getTime() < keepUsedMs;
    return now - published <= maxAgeMs;
  });
  kept.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  const unused = kept.filter((s) => !s.usedAt).slice(0, 40);
  const used = kept.filter((s) => s.usedAt);
  const unusedIds = new Set(unused.map((s) => s.id));
  return [...unused, ...used.filter((s) => !unusedIds.has(s.id))].slice(0, 80);
}

export function claimNext(
  queue: NewsQueue,
  now = Date.now(),
  maxAgeHours = config.news.maxAgeHours,
): { queue: NewsQueue; seed: NewsSeed | null } {
  const maxAgeMs = maxAgeHours * 36e5;
  const fresh = queue.seeds.filter((s) => {
    if (s.usedAt) return false;
    const published = new Date(s.publishedAt).getTime();
    return !Number.isNaN(published) && now - published <= maxAgeMs;
  });
  fresh.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  const seed = fresh[0];
  if (!seed) return { queue, seed: null };
  return {
    seed,
    queue: {
      ...queue,
      updatedAt: new Date(now).toISOString(),
      seeds: queue.seeds.map((s) =>
        s.id === seed.id ? { ...s, usedAt: new Date(now).toISOString() } : s,
      ),
    },
  };
}

/** What ideate sees. Headline, URL, and feed summary only — no extra facts. */
export function formatNewsSeed(seed: NewsSeed): string {
  return [
    "NEWS SEED (the only facts you may assert — do not add quotes, numbers, companies, or events that are not written here):",
    `HEADLINE: ${seed.headline}`,
    `SOURCE: ${seed.source}`,
    `URL: ${seed.url}`,
    `PUBLISHED: ${seed.publishedAt}`,
    `SUMMARY: ${seed.summary || "(the feed had no summary — stick to the headline)"}`,
  ].join("\n");
}

export async function loadNewsQueue(): Promise<NewsQueue> {
  try {
    return JSON.parse(await readFile(QUEUE_PATH, "utf8")) as NewsQueue;
  } catch {
    return { updatedAt: new Date(0).toISOString(), seeds: [] };
  }
}

async function saveNewsQueue(queue: NewsQueue): Promise<void> {
  await writeFile(QUEUE_PATH, JSON.stringify(queue, null, 2));
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "shorts-rev/0.1 (news-seed scanner)",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

async function fetchNewsApi(key: string, now: number): Promise<NewsSeed[]> {
  const q = encodeURIComponent('personal finance OR investing OR layoffs OR "AI jobs" OR inflation');
  const url = `https://newsapi.org/v2/everything?q=${q}&language=en&sortBy=publishedAt&pageSize=20&apiKey=${key}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`NewsAPI ${res.status}`);
  const data = (await res.json()) as {
    articles?: {
      title?: string;
      url?: string;
      description?: string | null;
      publishedAt?: string;
      source?: { name?: string };
    }[];
  };
  const seeds: NewsSeed[] = [];
  for (const a of data.articles ?? []) {
    if (!a.title || !a.url || a.title === "[Removed]") continue;
    const item: RssItem = {
      title: a.title,
      url: a.url,
      summary: summaryFrom(a.title, a.description ?? "", a.source?.name ?? "NewsAPI"),
      publishedAt: toIso(a.publishedAt ?? ""),
      source: a.source?.name ?? "NewsAPI",
    };
    const seed = seedFromItem(item, now);
    if (seed) seeds.push(seed);
  }
  return seeds;
}

/** Pull RSS (and NewsAPI if NEWS_API_KEY is set). One dead feed does not fail the scan. */
export async function refreshNews(): Promise<NewsSeed[]> {
  const now = Date.now();
  const incoming: NewsSeed[] = [];
  for (const feed of FEEDS) {
    try {
      const xml = await fetchText(feed.url);
      const items = parseFeed(xml, feed.source);
      let kept = 0;
      for (const item of items) {
        const seed = seedFromItem(item, now);
        if (seed) {
          incoming.push(seed);
          kept++;
        }
      }
      log("news", `${feed.source}: ${items.length} items, ${kept} in niche`);
    } catch (e: any) {
      log("news", `${feed.source} skipped: ${e.message}`);
    }
  }
  if (config.news.apiKey) {
    try {
      const extra = await fetchNewsApi(config.news.apiKey, now);
      incoming.push(...extra);
      log("news", `NewsAPI: ${extra.length} in niche`);
    } catch (e: any) {
      log("news", `NewsAPI skipped: ${e.message}`);
    }
  }

  const prev = await loadNewsQueue();
  const seeds = mergeSeeds(prev.seeds, incoming, now, config.news.maxAgeHours);
  const queue: NewsQueue = { updatedAt: new Date(now).toISOString(), seeds };
  await saveNewsQueue(queue);
  const fresh = seeds.filter((s) => !s.usedAt).length;
  log("news", `queue has ${fresh} fresh seeds (${seeds.length} stored, max age ${config.news.maxAgeHours}h)`);
  return seeds;
}

/** Mark the newest fresh seed used and return it. Null when the queue is empty. */
export async function claimNewsSeed(): Promise<NewsSeed | null> {
  const prev = await loadNewsQueue();
  const { queue, seed } = claimNext(prev, Date.now(), config.news.maxAgeHours);
  if (seed) await saveNewsQueue(queue);
  return seed;
}
