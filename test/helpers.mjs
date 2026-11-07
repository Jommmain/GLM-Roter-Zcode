import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function repoRoot() {
  return root;
}

export function isolatedHome() {
  const dir = mkdtempSync(path.join(tmpdir(), "glm-router-"));
  const xdg = path.join(dir, "xdg");
  const env = {
    PATH: process.env.PATH,
    HOME: dir,
    XDG_DATA_HOME: xdg,
    GLM_ROUTER_CONFIG_PATH: path.join(dir, "config.json"),
  };
  return { dir, xdg, env, homedir: dir, file: env.GLM_ROUTER_CONFIG_PATH };
}

export function runNode(args, { input = "", env = process.env, cwd = root } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timeout: ${args.join(" ")}`));
    }, 8000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") reject(error);
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}
