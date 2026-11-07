#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MAX_STDIN_BYTES } from "../lib/constants.mjs";
import { handleStdinText } from "../lib/hook-handler.mjs";

export async function readStdinLimited(stream, maxBytes = MAX_STDIN_BYTES) {
  const chunks = [];
  let total = 0;
  let overflow = false;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (overflow) continue;
    total += buffer.length;
    if (total > maxBytes) {
      overflow = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(buffer);
  }
  if (overflow) return { overflow: true };
  return { overflow: false, text: Buffer.concat(chunks).toString("utf8") };
}

async function main() {
  try {
    const read = await readStdinLimited(process.stdin);
    const result = read.overflow
      ? { exitCode: 0, stdout: "", stderr: "glm-router: STDIN_OVERFLOW\n" }
      : handleStdinText(read.text);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    process.exitCode = result.exitCode;
  } catch {
    process.stderr.write("glm-router: HOOK_UNEXPECTED\n");
    process.exitCode = 0;
  }
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main();
}
