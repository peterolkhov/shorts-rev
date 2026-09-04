import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";
import { config } from "../config.js";
import { log } from "../lib/util.js";
import { authedClient } from "./upload.js";

// Competitive hook intelligence: pull the top-performing finance Shorts from
// OTHER channels so ideation can steal the winning HOOK SHAPES (the playbook's
// "transcribe the hook, change 2-3 words"). Refreshed on the daily coach beat.

const QUERIES = [
  "money tips",
  "how to get rich",
  "personal finance",
  "side hustle",
  "investing for beginners",
  "money mistakes",
];
const HOOKS_PATH = path.join(config.root, "viral-hooks.json");

// keep to English-ish money titles; drop regional-language + game-content noise
const FINANCEY = /money|rich|save|saving|invest|hustle|cash|salary|wealth|budget|debt|dollar|\$|income|profit|broke|millionaire|retire|bank|fee|credit|tax|price/i;
const mostlyLatin = (t: string) => t.replace(/[^\x00-\x7F]/g, "").length / Math.max(t.length, 1) > 0.6;

export interface ViralHook {
  title: string;
  views: number;
  channel: string;
}

/** Search top finance Shorts (recent, most-viewed), save the best hooks to disk. */
export async function spyTopHooks(maxAgeDays = 90): Promise<ViralHook[]> {
  const yt = google.youtube({ version: "v3", auth: await authedClient() });
  const after = new Date(Date.now() - maxAgeDays * 864e5).toISOString();
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const q of QUERIES) {
    try {
      const s = await yt.search.list({
        part: ["snippet"],
        q,
        type: ["video"],
        videoDuration: "short",
        order: "viewCount",
        maxResults: 10,
        publishedAfter: after,
        regionCode: "US",
        relevanceLanguage: "en",
      });
      for (const it of s.data.items ?? []) {
        const id = it.id?.videoId;
        if (id && !seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    } catch (e: any) {
      log("spy", `search "${q}" failed: ${String(e.message).slice(0, 60)}`);
    }
  }
  if (!ids.length) return loadViralHooks();

  const all: ViralHook[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await yt.videos.list({ part: ["statistics", "snippet"], id: ids.slice(i, i + 50) });
    for (const v of r.data.items ?? []) {
      all.push({
        title: v.snippet!.title!,
        views: Number(v.statistics?.viewCount || 0),
        channel: v.snippet!.channelTitle!,
      });
    }
  }
  const top = all
    .filter((h) => FINANCEY.test(h.title) && mostlyLatin(h.title))
    .sort((a, b) => b.views - a.views)
    .slice(0, 20);
  if (top.length) {
    await writeFile(HOOKS_PATH, JSON.stringify(top, null, 2));
    log("spy", `saved ${top.length} viral finance hooks (top: ${Math.round((top[0]?.views || 0) / 1000)}k views — "${top[0]?.title.slice(0, 45)}")`);
  }
  return top;
}

export async function loadViralHooks(): Promise<ViralHook[]> {
  try {
    return JSON.parse(await readFile(HOOKS_PATH, "utf8")) as ViralHook[];
  } catch {
    return [];
  }
}
