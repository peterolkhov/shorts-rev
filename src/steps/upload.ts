import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { google } from "googleapis";
import { config, requireEnv } from "../config.js";
import { log } from "../lib/util.js";
import type { Script } from "./ideate.js";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/yt-analytics.readonly", // the feedback loop
  "https://www.googleapis.com/auth/youtube", // manage: delete/unlist videos
  "https://www.googleapis.com/auth/youtube.force-ssl", // read + reply to comments
];

/** Delete videos by id (needs the youtube scope — re-auth after adding it). */
export async function deleteVideos(ids: string[]): Promise<void> {
  const youtube = google.youtube({ version: "v3", auth: await authedClient() });
  for (const id of ids) {
    await youtube.videos.delete({ id });
    log("delete", `removed ${id}`);
  }
}
const CALLBACK_PORT = 4711; // loopback redirect (Google's OOB flow is retired)

function oauthClient(redirect = "http://localhost") {
  return new google.auth.OAuth2(
    requireEnv(config.youtube.clientId, "YOUTUBE_CLIENT_ID"),
    requireEnv(config.youtube.clientSecret, "YOUTUBE_CLIENT_SECRET"),
    redirect,
  );
}

/**
 * One-time interactive consent using the modern loopback flow: we spin up a
 * localhost server, send you to Google, and catch the redirect automatically —
 * no code copy-pasting. Run `npm run auth`.
 */
export async function authorize(): Promise<void> {
  const redirect = `http://localhost:${CALLBACK_PORT}`;
  const client = oauthClient(redirect);
  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("\nOpen this URL in your browser and approve access:\n\n" + url + "\n");
  console.log("Waiting for you to approve…");

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? "", redirect);
      const c = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<body style="font:600 20px system-ui;padding:3rem;text-align:center">${
          c ? "✅ Authorized. You can close this tab." : "❌ " + (err ?? "no code")
        }</body>`,
      );
      server.close();
      c ? resolve(c) : reject(new Error(err ?? "authorization failed"));
    });
    server.on("error", reject);
    server.listen(CALLBACK_PORT);
  });

  const { tokens } = await client.getToken(code);
  await writeFile(config.youtube.tokenPath, JSON.stringify(tokens, null, 2));
  log("auth", `saved credentials to ${config.youtube.tokenPath}`);
}

export async function authedClient() {
  const client = oauthClient();
  try {
    const raw = await readFile(config.youtube.tokenPath, "utf8");
    client.setCredentials(JSON.parse(raw));
  } catch {
    throw new Error("Not authorized yet. Run: npm run auth");
  }
  return client;
}

export async function upload(
  videoPath: string,
  script: Script,
  privacy: "private" | "unlisted" | "public" = config.youtube.privacy,
  publishAt?: string, // ISO 8601 — schedule native YouTube auto-publish
  thumbnailPath?: string, // custom clickable thumbnail (needs verified channel)
): Promise<string> {
  const auth = await authedClient();
  const youtube = google.youtube({ version: "v3", auth });

  const cta = config.cta.length ? `\n\n${config.cta.join("\n")}` : "";
  const description = `${script.description}${cta}\n\n#Shorts`;
  // A scheduled video MUST be uploaded private; YouTube flips it public at publishAt.
  const status = publishAt
    ? { privacyStatus: "private", publishAt, selfDeclaredMadeForKids: false }
    : { privacyStatus: privacy, selfDeclaredMadeForKids: false };
  log("upload", `uploading "${script.title}" (${publishAt ? `scheduled ${publishAt}` : privacy})`);

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: script.title.slice(0, 100),
        description,
        tags: script.tags,
        categoryId: "27", // Education
      },
      status,
    },
    media: { body: createReadStream(videoPath) },
  });

  const id = res.data.id!;

  // Set the custom thumbnail if provided. Requires a phone-verified channel —
  // tolerate failure so it never blocks the upload.
  if (thumbnailPath) {
    try {
      await youtube.thumbnails.set({ videoId: id, media: { body: createReadStream(thumbnailPath) } });
      log("upload", "custom thumbnail set");
    } catch (e: any) {
      log("upload", `thumbnail set failed (channel may need verification): ${e.message?.slice(0, 90)}`);
    }
  }

  const url = `https://youtube.com/shorts/${id}`;
  log("upload", `live: ${url}`);
  return url;
}
