import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = "0.1.0";
const name = `glm-router-${version}-zcode-experimental`;
const outDir = process.env.GLM_ROUTER_RELEASE_DIR || "/opt/cursor/artifacts";
const stagingParent = path.join(tmpdir(), `${name}-staging`);
const staging = path.join(stagingParent, name);

rmSync(stagingParent, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
cpSync(root, staging, {
  recursive: true,
  filter: (source) => {
    const relative = path.relative(root, source);
    if (!relative) return true;
    const top = relative.split(path.sep)[0];
    return ![".git", "node_modules", "agent-tools", "release"].includes(top);
  },
});

const stamp = spawnSync("find", [staging, "-exec", "touch", "-d", "2026-11-06 00:00:00 UTC", "{}", "+"], {
  encoding: "utf8",
});
if (stamp.status !== 0) {
  process.stderr.write(stamp.stderr || "touch failed\n");
  process.exit(stamp.status || 1);
}

mkdirSync(outDir, { recursive: true });
const zipPath = path.join(outDir, `${name}.zip`);
rmSync(zipPath, { force: true });
const zip = spawnSync("zip", ["-X", "-r", zipPath, name], {
  cwd: stagingParent,
  encoding: "utf8",
});
if (zip.status !== 0) {
  process.stderr.write(zip.stderr || zip.stdout || "zip failed\n");
  process.exit(zip.status || 1);
}

const bytes = readFileSync(zipPath);
const digest = createHash("sha256").update(bytes).digest("hex");
const sumPath = path.join(outDir, `${name}.sha256`);
writeFileSync(sumPath, `${digest}  ${name}.zip\n`);
const list = spawnSync("unzip", ["-l", zipPath], { encoding: "utf8" });
writeFileSync(path.join(outDir, `${name}-filelist.txt`), list.stdout || "");
process.stdout.write(`${zipPath}\n${digest}\n`);
