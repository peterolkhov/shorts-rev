import type { CaptionStyle } from "./types.js";

/**
 * Style options for SAMPLING different looks/voices without touching the proven
 * default playbook. The queue runner assigns these to a couple of experimental
 * videos so we can A/B new deliveries against what's already working.
 */

export interface VoiceOption {
  id: string; // ElevenLabs voice id
  name: string;
  note: string;
}

// ElevenLabs prebuilt public voices — varied delivery. If a voice isn't on the
// account, tts() falls back to the default so a sample never fails outright.
export const VOICE_POOL: VoiceOption[] = [
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", note: "deep, authoritative (default)" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", note: "young, energetic, punchy" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", note: "warm, conversational" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", note: "crisp, confident" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", note: "smooth female read" },
];

// Visual/art-direction styles for AI images — rotate across videos so the feed
// doesn't look samey. Passed as opts.visualStyle → the AI image prompt.
export const VISUAL_STYLES: Record<string, string> = {
  cinematic: "cinematic photograph, dramatic lighting, shallow depth of field, rich color, premium and moody",
  editorial3d: "clean 3D render, soft studio lighting, minimal editorial finance illustration, vivid accent color",
  neon: "neon-lit night scene, glowing accents, futuristic fintech aesthetic, high contrast, cinematic",
  boldFlat: "bold flat vector illustration, bright saturated colors, clean modern graphic design, high clarity",
  goldLuxe: "luxury finance aesthetic, gold and deep green tones, glossy, dramatic rim lighting, high-end",
};

// Footage LUT/filter fragments appended to the ffmpeg normalize chain — a strong
// grade instantly reads as "a different channel" when scrolling. Keyed by name;
// a format sets `footageFilter` to one of these keys. Kept to safe, built-in
// ffmpeg filters so a grade never breaks a render.
export const FOOTAGE_FILTERS: Record<string, string> = {
  none: "",
  noir: "format=gray,eq=contrast=1.32:brightness=-0.03,vignette=PI/4.5", // gritty B&W
  punch: "eq=saturation=1.75:contrast=1.22:brightness=0.02", // hyper-saturated, loud
  vhs: "noise=alls=11:allf=t+u,eq=saturation=1.28:contrast=1.06:gamma=0.95", // retro grain
  dream: "gblur=sigma=0.9,eq=saturation=1.42:brightness=0.04:contrast=1.05", // hazy/soft
  cold: "colorbalance=bs=0.28:bm=0.12,eq=contrast=1.15:saturation=1.1", // cold blue thriller
};

// Caption look presets. Each is merged over the playbook caption style.
export const CAPTION_PRESETS: Record<string, Partial<CaptionStyle>> = {
  classic: { maxWords: 2, highlightColor: "#FFE600", yFraction: 0.6, fontScale: 1.0 },
  boldGreen: { maxWords: 1, highlightColor: "#00FF66", yFraction: 0.62, fontScale: 1.18 },
  hormozi: { maxWords: 3, highlightColor: "#00E5FF", yFraction: 0.66, fontScale: 1.12 },
  punchRed: { maxWords: 2, highlightColor: "#FF3B3B", yFraction: 0.58, fontScale: 1.06 },
};
