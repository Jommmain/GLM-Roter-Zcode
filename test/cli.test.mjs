import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { isolatedHome, repoRoot, runNode } from "./helpers.mjs";

const cli = path.join(repoRoot(), "glm-router/bin/glm-router.mjs");

function run(args, isolated, extra = {}) {
  return runNode([cli, ...args], { env: isolated.env, ...extra });
}

test("CLI toggles mode and OpenRouter independently and global off wins", async () => {
  const isolated = isolatedHome();
  const semi = await run(["mode", "semi"], isolated);
  assert.equal(semi.code, 0);
  assert.match(semi.stdout, /semi/);

  const on = await run(["openrouter", "on"], isolated);
  assert.equal(on.code, 0);
  const status = JSON.parse((await run(["status", "--json"], isolated)).stdout);
  assert.equal(status.mode, "semi");
  assert.equal(status.openrouterEnabled, true);
  assert.equal(status.maxUsdPerRecommendation, null);
  assert.equal(status.invokedModel, false);

  const off = await run(["mode", "off"], isolated);
  assert.equal(off.code, 0);
  const after = JSON.parse((await run(["status", "--json"], isolated)).stdout);
  assert.equal(after.mode, "off");
  assert.equal(after.openrouterEnabled, true);

  const classified = await run(["classify", "--text", "Исправь опечатку в заголовке", "--json"], isolated);
  assert.equal(classified.code, 0);
  assert.equal(JSON.parse(classified.stdout).classified, false);
  assert.equal(readFileSync(isolated.file, "utf8").includes("Исправь опечатку"), false);
});

test("CLI rejects an invalid OpenRouter mapping and does not write it", async () => {
  const isolated = isolatedHome();
  await run(["mode", "semi"], isolated);
  const before = readFileSync(isolated.file, "utf8");
  const secret = ["sk", "live", "abcdef123456"].join("-");
  const rejected = await run(["openrouter-allow", "--model", secret, "--usd", "1"], isolated);
  assert.equal(rejected.code, 1);
  assert.equal(rejected.stderr.includes(secret), false);
  assert.equal(readFileSync(isolated.file, "utf8"), before);

  const bare = await run(["openrouter-allow", "--model", "GLM-5.3", "--usd", "1"], isolated);
  assert.equal(bare.code, 1);
  assert.match(bare.stderr, /BARE_DUPLICATE_ID/);
  assert.equal(readFileSync(isolated.file, "utf8"), before);
});

test("CLI allowlist is distinct from the subscription identity", async () => {
  const isolated = isolatedHome();
  await run(["mode", "semi"], isolated);
  await run(["openrouter", "on"], isolated);
  await run(["openrouter-cap", "--max-usd", "1"], isolated);
  const allowed = await run([
    "openrouter-allow",
    "--model",
    "z-ai/glm-5.3",
    "--usd",
    "0.2",
    "--name",
    "GLM-5.3",
  ], isolated);
  assert.equal(allowed.code, 0, allowed.stderr);
  const named = await run(["classify", "--text", "OpenRouter z-ai/glm-5.3", "--json"], isolated);
  const decision = JSON.parse(named.stdout);
  assert.equal(decision.identity.key, "openrouter::z-ai/glm-5.3");

  const duplicate = await run(["classify", "--text", "Use GLM-5.3 for this typo fix", "--json"], isolated);
  assert.equal(JSON.parse(duplicate.stdout).identity.key, "zai-subscription::GLM-5.3");

  await run(["quota", "exhausted"], isolated);
  const blocked = await run(["classify", "--text", "OpenRouter z-ai/glm-5.3", "--json"], isolated);
  const blockedDecision = JSON.parse(blocked.stdout);
  assert.equal(blockedDecision.action, "blocked");
  assert.equal(blockedDecision.identity, null);
  assert.equal(blockedDecision.openrouter.selected, false);
});

test("pointer lets the hook see a CLI config written outside plugin data", async () => {
  const isolated = isolatedHome();
  delete isolated.env.GLM_ROUTER_CONFIG_PATH;
  await run(["mode", "semi"], isolated);
  const pluginData = path.join(isolated.dir, "plugin-data");
  const hookEnv = {
    PATH: process.env.PATH,
    HOME: isolated.dir,
    XDG_DATA_HOME: isolated.xdg,
    ZCODE_PLUGIN_DATA: pluginData,
  };
  const result = await runNode([path.join(repoRoot(), "glm-router/hooks/glm-router-hook.mjs")], {
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "Fix the typo in the title" }),
    env: hookEnv,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /zai-subscription::GLM-5\.3-Flash/);
});
