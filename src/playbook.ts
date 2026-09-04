import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { defaultPlaybook } from "./strategy.js";
import { availableFormats, getFormat } from "./formats.js";
import { availableTracks, getTrack } from "./tracks.js";
import type { Playbook, VideoParams } from "./types.js";

const PLAYBOOK_PATH = path.join(config.root, "playbook.json");

export async function loadPlaybook(): Promise<Playbook> {
  try {
    return JSON.parse(await readFile(PLAYBOOK_PATH, "utf8")) as Playbook;
  } catch {
    const pb = defaultPlaybook();
    await savePlaybook(pb);
    return pb;
  }
}

export async function savePlaybook(pb: Playbook): Promise<void> {
  await writeFile(PLAYBOOK_PATH, JSON.stringify(pb, null, 2));
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** Weighted random choice among ids, falling back to `fallback` if empty. */
function pickWeighted(
  ids: string[],
  weights: Record<string, number>,
  fallback: string,
): string {
  if (!ids.length) return fallback;
  const w = ids.map((id) => Math.max(weights[id] ?? 1, 0.01));
  const total = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < ids.length; i++) {
    r -= w[i];
    if (r <= 0) return ids[i];
  }
  return ids[ids.length - 1];
}

/** Weighted pick among formats that are enabled AND have their API key set. */
function pickFormat(pb: Playbook) {
  const avail = availableFormats(pb.enabledFormats);
  if (!avail.length) return getFormat("finance-narration");
  const id = pickWeighted(avail.map((f) => f.id), pb.formatWeights, avail[0].id);
  return getFormat(id);
}

/**
 * Bandit step. With probability = exploreRate, perturb ONE knob so the coach
 * can attribute a performance change to it. Otherwise exploit the playbook.
 * Returns the params for this video + whether/what we explored.
 */
export function draw(pb: Playbook): {
  params: VideoParams;
  exploring: boolean;
  dimension?: string;
} {
  const format = pickFormat(pb);
  const track = pickWeighted(
    availableTracks(pb.enabledTracks).map((t) => t.id),
    pb.trackWeights,
    getTrack("finance").id,
  );
  const base: VideoParams = {
    topic: "", // filled by ideate
    track,
    format: format.id,
    voice: { ...pb.voice },
    // format caption overrides layer on top of the learned playbook caption
    caption: { ...pb.caption, ...format.caption },
    visual: { ...pb.visual, segmentSeconds: format.clipSeconds },
    targetLengthSec: pb.targetLengthSec,
  };

  if (Math.random() > pb.exploreRate) {
    return { params: base, exploring: false };
  }

  const dims = ["voice.style", "voice.speed", "cut", "captionY", "length"];
  const dim = dims[Math.floor(Math.random() * dims.length)];
  const jitter = () => (Math.random() < 0.5 ? -1 : 1);

  switch (dim) {
    case "voice.style":
      base.voice.style = clamp(base.voice.style + jitter() * 0.2, 0, 0.9);
      break;
    case "voice.speed":
      base.voice.speed = clamp(base.voice.speed + jitter() * 0.06, 1.0, 1.2);
      break;
    case "cut":
      base.visual.segmentSeconds = clamp(
        base.visual.segmentSeconds + jitter() * 0.7,
        1.8,
        4.5,
      );
      break;
    case "captionY":
      base.caption.yFraction = clamp(
        base.caption.yFraction + jitter() * 0.06,
        0.55,
        0.82,
      );
      break;
    case "length":
      base.targetLengthSec = clamp(
        base.targetLengthSec + jitter() * 7,
        28,
        58,
      );
      break;
  }
  return { params: base, exploring: true, dimension: dim };
}
