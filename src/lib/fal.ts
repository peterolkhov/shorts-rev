import { readFile } from "node:fs/promises";
import path from "node:path";
import { config, requireEnv } from "../config.js";
import { log } from "./util.js";

/**
 * Upload a local file to fal's CDN and return the file URL models accept.
 * POST https://rest.fal.ai/storage/upload/initiate then PUT the bytes.
 */
export async function falUpload(filePath: string, contentType: string): Promise<string> {
  const key = requireEnv(config.fal.apiKey, "FAL_KEY");
  const init = await fetch(
    "https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
    {
      method: "POST",
      headers: {
        Authorization: `Key ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        file_name: path.basename(filePath),
        content_type: contentType,
      }),
    },
  );
  if (!init.ok) {
    throw new Error(`fal upload init ${init.status}: ${(await init.text()).slice(0, 180)}`);
  }
  const { upload_url, file_url } = (await init.json()) as {
    upload_url: string;
    file_url: string;
  };
  const bytes = await readFile(filePath);
  const put = await fetch(upload_url, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: bytes,
  });
  if (!put.ok) throw new Error(`fal upload put ${put.status}`);
  return file_url;
}

/**
 * Minimal fal.ai queue-API client (no SDK). Submits a job, polls until done,
 * returns the result JSON. Works for both image and video models — same pattern.
 */
export async function falRun(
  model: string,
  input: Record<string, unknown>,
): Promise<any> {
  const key = requireEnv(config.fal.apiKey, "FAL_KEY");
  const headers = {
    Authorization: `Key ${key}`,
    "content-type": "application/json",
  };

  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  if (!submit.ok) {
    throw new Error(`fal submit ${submit.status}: ${await submit.text()}`);
  }
  const { status_url, response_url } = (await submit.json()) as {
    status_url: string;
    response_url: string;
  };

  // Poll (video can take a minute+). Cap at ~5 min.
  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    const s = await fetch(status_url, { headers });
    const st = (await s.json()) as { status: string };
    if (st.status === "COMPLETED") break;
    if (st.status !== "IN_QUEUE" && st.status !== "IN_PROGRESS") {
      throw new Error(`fal status: ${JSON.stringify(st)}`);
    }
    if (i % 5 === 0) log("fal", `${model} … ${st.status}`);
  }

  const res = await fetch(response_url, { headers });
  if (!res.ok) throw new Error(`fal result ${res.status}: ${await res.text()}`);
  return res.json();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
