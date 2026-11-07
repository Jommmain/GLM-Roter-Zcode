import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const COMMAND_RE = /^[a-z0-9][a-z0-9_:-]{0,63}$/;

export function pluginRootFromHere() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function repoRootFromHere() {
  return path.resolve(pluginRootFromHere(), "..");
}

export function checkPackage(root = repoRootFromHere()) {
  const errors = [];
  const pluginDir = path.join(root, "glm-router");
  const marketplacePath = path.join(root, "marketplace.json");
  const pluginManifestPath = path.join(pluginDir, ".zcode-plugin", "plugin.json");
  const hooksPath = path.join(pluginDir, "hooks", "hooks.json");

  const marketplace = readJson(marketplacePath, errors, "marketplace.json");
  const manifest = readJson(pluginManifestPath, errors, ".zcode-plugin/plugin.json");
  const hooks = readJson(hooksPath, errors, "hooks/hooks.json");
  if (!marketplace || !manifest || !hooks) return { ok: false, errors };

  if (!NAME_RE.test(marketplace.name || "")) errors.push("marketplace.name");
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length !== 1) errors.push("marketplace.plugins");
  const entry = marketplace.plugins?.[0] || {};
  if (entry.name !== "glm-router") errors.push("marketplace.plugins[0].name");
  if (entry.source !== "./glm-router") errors.push("marketplace.plugins[0].source");
  if (entry.version !== "0.1.0") errors.push("marketplace.version");
  if (entry.strict !== true) errors.push("marketplace.strict");
  if (JSON.stringify(marketplace).includes("github.com") || JSON.stringify(marketplace).includes("Authorization")) {
    errors.push("marketplace.remote-or-auth");
  }

  if (manifest.name !== "glm-router" || !NAME_RE.test(manifest.name)) errors.push("plugin.name");
  if (manifest.version !== entry.version) errors.push("plugin.version");
  if (Object.prototype.hasOwnProperty.call(manifest, "hooks")) errors.push("plugin.hooks-duplicate");
  if (Object.prototype.hasOwnProperty.call(manifest, "agents")) errors.push("plugin.agents-autodiscovery");
  if (manifest.commands !== "commands") errors.push("plugin.commands");
  for (const key of ["channels", "lspServers", "outputStyles", "settings", "mcpServers", "userConfig"]) {
    if (Object.prototype.hasOwnProperty.call(manifest, key)) errors.push(`plugin.${key}`);
  }

  const userPrompt = hooks.hooks?.UserPromptSubmit?.[0]?.hooks?.[0];
  const preTool = hooks.hooks?.PreToolUse?.[0];
  const preHook = preTool?.hooks?.[0];
  if (preTool?.matcher !== "Agent|Task") errors.push("hooks.matcher");
  for (const hook of [userPrompt, preHook]) {
    if (!hook || hook.type !== "process" || hook.command !== "node") errors.push("hooks.executor");
    if (!Array.isArray(hook?.args) || hook.args[0] !== "${ZCODE_PLUGIN_ROOT}/hooks/glm-router-hook.mjs") {
      errors.push("hooks.args");
    }
    if (hook?.timeoutMs !== 5000) errors.push("hooks.timeout");
  }

  if (existsSync(path.join(pluginDir, "agents"))) errors.push("agents-directory-active");
  const commandsDir = path.join(pluginDir, "commands");
  const commandFiles = readdirSync(commandsDir).filter((name) => name.endsWith(".md"));
  if (commandFiles.length < 8) errors.push("commands.missing");
  for (const file of commandFiles) {
    const stem = file.replace(/\.md$/, "");
    if (!COMMAND_RE.test(stem)) errors.push(`command.name:${stem}`);
    const body = readFileSync(path.join(commandsDir, file), "utf8");
    const frontmatter = body.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatter) errors.push(`command.frontmatter:${stem}`);
    else if (/^model\s*:/m.test(frontmatter[1])) errors.push(`command.model:${stem}`);
  }

  const templates = path.join(pluginDir, "templates", "agents");
  for (const name of ["glm-zai-main.md", "glm-zai-flash.md"]) {
    const file = path.join(templates, name);
    if (!existsSync(file)) errors.push(`template.missing:${name}`);
    else {
      const text = readFileSync(file, "utf8");
      if (!/^model:\s*inherit\s*$/m.test(text)) errors.push(`template.model:${name}`);
      if (/GLM-5\.3/.test(text.split("---")[1] || "") && /^model:\s*(?!inherit)/m.test(text)) {
        errors.push(`template.bound:${name}`);
      }
    }
  }

  const hookSource = readFileSync(path.join(pluginDir, "hooks", "glm-router-hook.mjs"), "utf8");
  if (/node:(http|https|net|dns)|fetch\(|child_process/.test(hookSource)) errors.push("hook.network");

  return { ok: errors.length === 0, errors };
}

function readJson(file, errors, label) {
  if (!existsSync(file) || !statSync(file).isFile()) {
    errors.push(`missing:${label}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    errors.push(`json:${label}`);
    return null;
  }
}
