// Shared data shapes for the self-improvement loop.

export interface VoiceParams {
  stability: number; // 0..1  lower = more expressive
  style: number; // 0..1  higher = more dramatic delivery
  speed: number; // 0.7..1.2  ElevenLabs playback speed
}

export interface CaptionStyle {
  maxWords: number; // words per on-screen chunk (2-3 is punchy)
  fillColor: string; // inactive words, e.g. "#FFFFFF"
  highlightColor: string; // the currently-spoken word (karaoke), e.g. "#FFE600"
  strokeColor: string; // e.g. "rgba(0,0,0,0.95)"
  yFraction: number; // vertical position, 0=top 1=bottom (0.6 = hot zone)
  fontScale: number; // multiplier on base font size
  boxColor?: string; // if set, fill a solid block behind the ACTIVE word (bold TikTok/Hormozi look)
  boxTextColor?: string; // text color of the word sitting inside the box (defaults to fillColor)
}

export type VisualMode = "stock" | "gameplay" | "mixed";

export interface VisualParams {
  mode: VisualMode;
  segmentSeconds: number; // how long each B-roll cut holds (pacing)
}

/** The evolving strategy the coach tunes. Persisted as playbook.json. */
export interface Playbook {
  updatedAt: string;
  hookGuidance: string; // general learned instruction for hooks (any track)
  replicate?: string; // the current top-outlier's winning formula to CLONE (hook/format/angle), or a "no clear outlier yet" note
  voice: VoiceParams;
  caption: CaptionStyle;
  visual: VisualParams;
  targetLengthSec: number;
  exploreRate: number; // epsilon: probability of trying a variation
  enabledFormats: string[]; // format ids the bandit may choose among
  formatWeights: Record<string, number>; // relative pick weight per format
  enabledTracks: string[]; // content tracks the bandit may choose among
  trackWeights: Record<string, number>; // relative pick weight per track
  notes: string; // coach's running rationale
}

/** Params that actually produced one video (for attribution). */
export interface VideoParams {
  topic: string;
  track: string; // content domain (finance / entertainment / …)
  format: string; // visual style used
  voice: VoiceParams;
  caption: CaptionStyle;
  visual: VisualParams;
  targetLengthSec: number;
}

export interface Performance {
  views: number;
  avgViewPct: number; // averageViewPercentage — the key retention signal
  avgViewSec: number;
  likes: number;
  comments: number;
  estRevenue: number; // USD
  rpm: number; // revenue per 1000 views
  sampledAt: string;
}

export interface LedgerEntry {
  id: string;
  createdAt: string;
  videoPath: string;
  youtubeId?: string;
  deleted?: boolean; // true if the YouTube video was deleted (e.g. a dead repost) — skip in reads
  repostCount?: number; // how many times this topic has been recycled (dead -> reposted). Capped to avoid churn.
  tiktokId?: string; // TikTok publish_id (draft in inbox, or live if auto-post approved)
  reelId?: string; // Instagram Reels media id
  fbReelId?: string; // Facebook Reels video id
  publicUrl?: string; // R2-hosted mp4 URL (Meta pulls the file from here)
  exploring: boolean; // was this an exploration (variation) run?
  exploredDimension?: string; // which knob was perturbed
  title: string;
  hook: string;
  params: VideoParams;
  performance?: Performance;
}
