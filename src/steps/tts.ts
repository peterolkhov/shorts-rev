import { writeFile } from "node:fs/promises";
import { config, requireEnv } from "../config.js";
import { log } from "../lib/util.js";
import type { VoiceParams } from "../types.js";

export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface TtsResult {
  audioPath: string;
  words: Word[];
}

/**
 * ElevenLabs "with-timestamps" returns character-level alignment, which we
 * collapse into word timings for karaoke-style captions. Voice settings are
 * supplied by the playbook so the coach can tune delivery.
 */
export async function tts(
  text: string,
  audioPath: string,
  voice: VoiceParams,
  voiceId: string = config.elevenlabs.voiceId,
): Promise<TtsResult> {
  const key = requireEnv(config.elevenlabs.apiKey, "ELEVENLABS_API_KEY");
  log("tts", `synthesizing ${text.length} chars @ voice=${voiceId} style=${voice.style} speed=${voice.speed}`);

  const call = (vid: string) =>
    fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}/with-timestamps`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: config.elevenlabs.modelId,
        voice_settings: {
          stability: voice.stability,
          similarity_boost: 0.75,
          style: voice.style,
          speed: voice.speed,
        },
      }),
    });

  let res = await call(voiceId);
  // A sample voice not on the account → fall back to the default so it never fails.
  if (!res.ok && voiceId !== config.elevenlabs.voiceId) {
    log("tts", `voice ${voiceId} failed (${res.status}); falling back to default`);
    res = await call(config.elevenlabs.voiceId);
  }
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    audio_base64: string;
    alignment: {
      characters: string[];
      character_start_times_seconds: number[];
      character_end_times_seconds: number[];
    };
  };

  await writeFile(audioPath, Buffer.from(data.audio_base64, "base64"));

  const words = collapseToWords(data.alignment);
  log("tts", `${words.length} words, ${words.at(-1)?.end.toFixed(1)}s audio`);
  return { audioPath, words };
}

function collapseToWords(a: {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}): Word[] {
  const words: Word[] = [];
  let cur = "";
  let start = 0;
  let end = 0;

  for (let i = 0; i < a.characters.length; i++) {
    const ch = a.characters[i];
    const isSpace = /\s/.test(ch);
    if (isSpace) {
      if (cur.trim()) words.push({ text: cur.trim(), start, end });
      cur = "";
      continue;
    }
    if (!cur) start = a.character_start_times_seconds[i];
    cur += ch;
    end = a.character_end_times_seconds[i];
  }
  if (cur.trim()) words.push({ text: cur.trim(), start, end });
  return words;
}
