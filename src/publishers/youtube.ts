import { existsSync } from "node:fs";
import { config } from "../config.js";
import { upload } from "../steps/upload.js";
import type { Publisher, PublishResult } from "./types.js";
import type { Script } from "../steps/ideate.js";

/** YouTube adapter — thin wrapper over the existing steps/upload.ts. */
export const youtube: Publisher = {
  name: "youtube",
  ledgerKey: "youtubeId",

  isConfigured() {
    return Boolean(
      config.youtube.clientId &&
        config.youtube.clientSecret &&
        existsSync(config.youtube.tokenPath),
    );
  },

  async publish(
    videoPath: string,
    script: Script,
    privacy: "private" | "unlisted" | "public",
  ): Promise<PublishResult> {
    const url = await upload(videoPath, script, privacy);
    const id = url.split("/").pop();
    return { platform: "youtube", status: "posted", id, url };
  },
};
