import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { defaultConfig } from "../glm-router/lib/constants.mjs";
import { saveConfig } from "../glm-router/lib/config.mjs";
import { handleStdinText } from "../glm-router/lib/hook-handler.mjs";
import { isolatedHome, repoRoot, runNode } from "./helpers.mjs";

function semiEnv() {
  const isolated = isolatedHome();
  const config = defaultConfig();
  config.mode = "semi";
  saveConfig(config, isolated.env, isolated.homedir);
  return isolated;
}

test("off mode ignores a complex prompt and an OpenRouter tool call", () => {
  const isolated = isolatedHome();
  const config = defaultConfig();
  config.providers.openrouter.enabled = true;
  saveConfig(config, isolated.env, isolated.homedir);
  const token = "UNIQUE_PROMPT_TOKEN_OFF";
  const prompt = handleStdinText(
    JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: `Исправь опечатку ${token}` }),
    isolated.env,
    isolated.homedir,
  );
  assert.equal(prompt.exitCode, 0);
  assert.equal(prompt.stdout, "");
  assert.equal(prompt.stderr, "");
  assert.equal(`${prompt.stdout}${prompt.stderr}`.includes(token), false);

  const tool = handleStdinText(
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { model: "GLM-5.3", description: token },
    }),
    isolated.env,
    isolated.homedir,
  );
  assert.equal(tool.stdout, "");
  assert.equal(tool.stderr, "");
});

test("semi injects advice once and never blocks a repeat of the same prompt", () => {
  const isolated = semiEnv();
  const body = JSON.stringify({
    hook_event_name: "UserPromptSubmit",
    prompt: "Исправь опечатку в заголовке",
  });
  const first = handleStdinText(body, isolated.env, isolated.homedir);
  const second = handleStdinText(body, isolated.env, isolated.homedir);
  for (const result of [first, second]) {
    assert.equal(result.exitCode, 0);
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(parsed), ["hookSpecificOutput"]);
    assert.equal(parsed.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.equal(Object.hasOwn(parsed, "continue"), false);
    assert.equal(Object.hasOwn(parsed.hookSpecificOutput, "permissionDecision"), false);
    assert.match(parsed.hookSpecificOutput.additionalContext, /GLM-5\.3-Flash/);
    assert.match(parsed.hookSpecificOutput.additionalContext, /zai-subscription::GLM-5\.3-Flash/);
    assert.match(parsed.hookSpecificOutput.additionalContext, /OpenRouter: выключен/);
  }
});

test("bypass prefix and ambiguous text do not block", () => {
  const isolated = semiEnv();
  const bypass = handleStdinText(
    JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "[[glm-router:bypass]] сделай хорошо" }),
    isolated.env,
    isolated.homedir,
  );
  assert.equal(bypass.stdout, "");
  assert.equal(bypass.stderr, "");

  const ask = handleStdinText(
    JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "сделай хорошо" }),
    isolated.env,
    isolated.homedir,
  );
  const parsed = JSON.parse(ask.stdout);
  assert.match(parsed.hookSpecificOutput.additionalContext, /Нужно уточнение/);
  assert.equal(ask.stdout.includes('"continue"'), false);
});

test("malformed, non-string and oversized hook input fail open", async () => {
  const isolated = semiEnv();
  const malformed = handleStdinText("{", isolated.env, isolated.homedir);
  assert.equal(malformed.exitCode, 0);
  assert.equal(malformed.stdout, "");
  assert.match(malformed.stderr, /STDIN_MALFORMED/);

  const array = handleStdinText("[]", isolated.env, isolated.homedir);
  assert.equal(array.stdout, "");
  assert.match(array.stderr, /STDIN_MALFORMED/);

  const typed = handleStdinText(
    JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: { text: "Fix the typo" } }),
    isolated.env,
    isolated.homedir,
  );
  assert.equal(typed.stdout, "");
  assert.match(typed.stderr, /PROMPT_TYPE/);

  const huge = `{${"a".repeat(300_000)}`;
  const spawned = await runNode([path.join(repoRoot(), "glm-router/hooks/glm-router-hook.mjs")], {
    input: huge,
    env: isolated.env,
  });
  assert.equal(spawned.code, 0);
  assert.equal(spawned.stdout, "");
  assert.match(spawned.stderr, /STDIN_OVERFLOW/);
  assert.equal(spawned.stderr.includes("a".repeat(80)), false);
});

test("invalid config fail-opens and does not deny a tool", () => {
  const isolated = isolatedHome();
  writeFileSync(isolated.file, "{", "utf8");
  const prompt = handleStdinText(
    JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "Исправь опечатку в заголовке" }),
    isolated.env,
    isolated.homedir,
  );
  assert.equal(prompt.exitCode, 0);
  assert.equal(prompt.stdout, "");
  assert.match(prompt.stderr, /CONFIG_JSON/);

  const tool = handleStdinText(
    JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { model: "GLM-5.3" } }),
    isolated.env,
    isolated.homedir,
  );
  assert.equal(tool.stdout, "");
  assert.match(tool.stderr, /CONFIG_JSON/);
});

test("ambiguous and disabled OpenRouter tool routes fail closed without rewriting input", () => {
  const isolated = semiEnv();
  const bare = handleStdinText(
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Task",
      tool_input: { model: "GLM-5.3", description: "UNIQUE_TOOL_BODY" },
    }),
    isolated.env,
    isolated.homedir,
  );
  const bareJson = JSON.parse(bare.stdout);
  assert.equal(bareJson.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(Object.hasOwn(bareJson.hookSpecificOutput, "updatedInput"), false);
  assert.equal(bare.stdout.includes("UNIQUE_TOOL_BODY"), false);
  assert.match(bareJson.hookSpecificOutput.permissionDecisionReason, /GLM-5\.3/);

  const foreign = handleStdinText(
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { model: "openrouter:z-ai/glm-5.3" },
    }),
    isolated.env,
    isolated.homedir,
  );
  assert.equal(JSON.parse(foreign.stdout).hookSpecificOutput.permissionDecision, "deny");

  const unrelated = handleStdinText(
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { description: "GLM-5.3 в тексте задачи, не в поле модели" },
    }),
    isolated.env,
    isolated.homedir,
  );
  assert.equal(unrelated.stdout, "");
  assert.equal(unrelated.stderr, "");
});

test("eligible OpenRouter is denied when declared quota is exhausted", () => {
  const isolated = isolatedHome();
  const config = defaultConfig();
  config.mode = "semi";
  config.quota.declaredState = "exhausted";
  config.providers.openrouter.enabled = true;
  config.providers.openrouter.maxUsdPerRecommendation = 1;
  config.providers.openrouter.allowedModels = [
    {
      provider: "openrouter",
      modelId: "z-ai/glm-5.3",
      displayName: "GLM-5.3",
      declaredUsdPerCall: 0.1,
      bindingConfirmed: false,
    },
  ];
  saveConfig(config, isolated.env, isolated.homedir);
  const result = handleStdinText(
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { model: "z-ai/glm-5.3" },
    }),
    isolated.env,
    isolated.homedir,
  );
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.match(result.stderr, /QUOTA_NO_FALLBACK/);
});

test("confirmed subscription id is stored locally and is not copied into hook context", () => {
  const isolated = semiEnv();
  const config = defaultConfig();
  config.mode = "semi";
  config.providers.zai_subscription.models.flash.bindingConfirmed = true;
  config.providers.zai_subscription.models.flash.modelId = "builtin-flash-marker-77";
  saveConfig(config, isolated.env, isolated.homedir);
  const result = handleStdinText(
    JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "Fix the typo in the title" }),
    isolated.env,
    isolated.homedir,
  );
  assert.equal(result.stdout.includes("builtin-flash-marker-77"), false);
  assert.match(result.stdout, /ручн|селектор|не меняет/i);
});
