import { spawn } from "node:child_process";

export function log(step: string, msg: string) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`\x1b[2m${t}\x1b[0m \x1b[36m${step.padEnd(9)}\x1b[0m ${msg}`);
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Run a command, streaming nothing, rejecting on non-zero exit. */
export function run(
  cmd: string,
  args: string[],
  cwd?: string,
  timeoutMs = 300000, // 5 min backstop — assemble's final encode is legitimately heavy
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], cwd });
    let err = "";
    // Hard timeout so one pathological ffmpeg can't hang the whole pipeline.
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    // Keep only the tail — a chatty ffmpeg can otherwise overflow Node's max
    // string length (RangeError) before the process even finishes.
    p.stderr.on("data", (d) => (err = (err + d.toString()).slice(-16000)));
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} exited ${code}\n${err.slice(-1500)}`));
    });
  });
}

/** Run a command and capture stdout. */
export function capture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err = (err + d.toString()).slice(-16000)));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} failed: ${err}`)),
    );
  });
}

export async function ffprobeDuration(file: string): Promise<number> {
  const out = await capture("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  return parseFloat(out.trim());
}
