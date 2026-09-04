import { config, requireEnv } from "../config.js";
import { log } from "./util.js";

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
