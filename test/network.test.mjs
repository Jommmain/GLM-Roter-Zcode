import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { defaultConfig } from "../glm-router/lib/constants.mjs";
import { saveConfig } from "../glm-router/lib/config.mjs";
import { isolatedHome, repoRoot, runNode } from "./helpers.mjs";

test("hook and classifier perform no outbound network", async () => {
  const isolated = isolatedHome();
  const config = defaultConfig();
  config.mode = "semi";
  saveConfig(config, isolated.env, isolated.homedir);
  const marker = path.join(isolated.dir, "network-marker.txt");
  const env = { ...isolated.env, GLM_ROUTER_NETWORK_MARKER: marker };
  const hook = path.join(repoRoot(), "glm-router/hooks/glm-router-hook.mjs");
  const preload = path.join(repoRoot(), "test/block-network.mjs");
  const prompt = await runNode(["--import", preload, hook], {
    input: JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      prompt: "Сначала спроектируй миграцию базы, затем обнови код и проверь откат",
    }),
    env,
  });
  assert.equal(prompt.code, 0, prompt.stderr);
  assert.match(prompt.stdout, /zai-subscription::GLM-5\.3/);
  const tool = await runNode(["--import", preload, hook], {
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { model: "GLM-5.3" },
    }),
    env,
  });
  assert.equal(tool.code, 0, tool.stderr);
  assert.match(tool.stdout, /permissionDecision":"deny/);
  assert.equal(existsSync(marker), false, existsSync(marker) ? readFileSync(marker, "utf8") : "");
});
