import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config, requireEnv } from "../config.js";
import { log } from "./util.js";

/**
 * Upload a file to Cloudflare R2 and return its public URL.
 *
 * Meta's Reels APIs (Instagram + Facebook) don't accept a byte upload — they
 * PULL the video from a public URL. So before publishing to Meta we stash the
 * mp4 on R2 (S3-compatible, cheap, no egress fees) and hand Meta the link.
 *
 * We sign the PutObject with AWS Signature V4 by hand (node:crypto only) so the
 * project stays dependency-light — no @aws-sdk/client-s3.
 */
const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data, "utf8").digest();
const sha256hex = (data: Buffer | string): string =>
  createHash("sha256").update(data).digest("hex");

export function r2Configured(): boolean {
  const r = config.r2;
  return Boolean(
    r.accountId && r.accessKeyId && r.secretAccessKey && r.bucket && r.publicBaseUrl,
  );
}

/** ISO basic format the way SigV4 wants it: YYYYMMDDTHHMMSSZ. */
function amzTimestamp(): { amzDate: string; dateStamp: string } {
  const iso = new Date().toISOString(); // 2026-07-04T16:00:00.000Z
  const amzDate = iso.replace(/[:-]|\.\d{3}/g, ""); // 20260704T160000Z
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * PUT a local file to R2 under `key` (defaults to the file's basename) and
 * return the public URL Meta will fetch it from.
 */
export async function uploadToR2(localPath: string, key?: string): Promise<string> {
  const accountId = requireEnv(config.r2.accountId, "R2_ACCOUNT_ID");
  const accessKeyId = requireEnv(config.r2.accessKeyId, "R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv(config.r2.secretAccessKey, "R2_SECRET_ACCESS_KEY");
  const bucket = requireEnv(config.r2.bucket, "R2_BUCKET");
  const publicBaseUrl = requireEnv(config.r2.publicBaseUrl, "R2_PUBLIC_BASE_URL");

  const objectKey = key ?? path.basename(localPath);
  const body = await readFile(localPath);

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const service = "s3";
  const region = "auto"; // R2 uses the literal region "auto"
  const { amzDate, dateStamp } = amzTimestamp();
  const payloadHash = sha256hex(body);

  // R2 keys can contain "/"; encode each segment but keep the separators.
  const canonicalUri =
    "/" +
    bucket +
    "/" +
    objectKey
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");

  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "", // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: "PUT",
    headers: {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization,
      "content-type": "video/mp4",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`R2 upload ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const url = `${publicBaseUrl}/${objectKey
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/")}`;
  log("r2", `hosted ${url}`);
  return url;
}
