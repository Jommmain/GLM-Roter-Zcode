import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipDirs = new Set([".git", "node_modules", "agent-tools", "release"]);
const binaryExt = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"]);
const secretRe = /sk-[A-Za-z0-9]{8,}|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}/;
const zcodeReadRe = /readFileSync\([^)]*\.zcode|openSync\([^)]*\.zcode|~\/\.zcode\/v2\/config\.json/;

export function scanTree(start = root) {
  const findings = [];
  walk(start, findings);
  return findings;
}

function walk(current, findings) {
  const stat = statSync(current);
  if (stat.isDirectory()) {
    if (skipDirs.has(path.basename(current))) return;
    for (const entry of readdirSync(current)) walk(path.join(current, entry), findings);
    return;
  }
  const ext = path.extname(current).toLowerCase();
  const relative = path.relative(root, current);
  if (binaryExt.has(ext)) findings.push(`${relative}: binary or screenshot-like file`);
  if (!stat.isFile() || stat.size > 1_000_000) return;
  if (!/\.(mjs|js|json|md|txt)$/.test(current)) return;
  const text = readFileSync(current, "utf8");
  if (secretRe.test(text)) findings.push(`${relative}: secret-like pattern`);
  if (relative.startsWith("glm-router/") && zcodeReadRe.test(text)) {
    findings.push(`${relative}: possible app-config read`);
  }
}

function isDirectRun() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const findings = scanTree();
  if (findings.length > 0) {
    process.stderr.write(`${findings.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write("security-scan: clean\n");
}
