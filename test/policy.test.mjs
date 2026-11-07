import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig } from "../glm-router/lib/constants.mjs";
import { evaluatePrompt } from "../glm-router/lib/policy.mjs";
import { renderDecision } from "../glm-router/lib/render.mjs";
import { resetSignalStats, signalStats } from "../glm-router/lib/signals.mjs";

function semiConfig() {
  const config = defaultConfig();
  config.mode = "semi";
  return config;
}

function allowOpenrouter(config, modelId = "z-ai/glm-5.3", usd = 0.2, cap = 1) {
  config.providers.openrouter.enabled = true;
  config.providers.openrouter.maxUsdPerRecommendation = cap;
  config.providers.openrouter.allowedModels = [
    {
      provider: "openrouter",
      modelId,
      displayName: "GLM-5.3",
      declaredUsdPerCall: usd,
      bindingConfirmed: false,
    },
  ];
  return config;
}

test("mode off does not classify", () => {
  resetSignalStats();
  const decision = evaluatePrompt(defaultConfig(), "Сначала спроектируй миграцию базы, затем проверь откат");
  assert.equal(decision.type, "passthrough");
  assert.equal(decision.mode, "off");
  assert.equal(signalStats.calls, 0);
});

test("bounded Russian and English prompts prefer builtin Flash", () => {
  for (const prompt of ["Исправь опечатку в заголовке", "Fix the typo in the title"]) {
    const decision = evaluatePrompt(semiConfig(), prompt);
    assert.equal(decision.action, "recommend");
    assert.equal(decision.identity.provider, "zai-subscription");
    assert.equal(decision.identity.key, "zai-subscription::GLM-5.3-Flash");
    assert.equal(decision.execution.invokedModel, false);
    assert.equal(decision.execution.route, "manual-selector");
    assert.ok(decision.reasonCodes.includes("BOUNDED_LOW_RISK"));
  }
});

test("multi-step and high-risk Russian and English prompts prefer builtin GLM-5.3", () => {
  const prompts = [
    "Сначала спроектируй миграцию базы, затем обнови код и проверь откат",
    "Design the auth migration and then implement tests for rollback",
    "Почему падает этот тест при пустом вводе?",
    "Why does this test fail on empty input?",
  ];
  for (const prompt of prompts) {
    const decision = evaluatePrompt(semiConfig(), prompt);
    assert.equal(decision.action, "recommend", prompt);
    assert.equal(decision.identity.key, "zai-subscription::GLM-5.3", prompt);
    assert.equal(decision.openrouter.selected, false, prompt);
  }
});

test("ambiguous prompts ask and do not pick a model", () => {
  for (const prompt of ["сделай хорошо", "make it better"]) {
    const decision = evaluatePrompt(semiConfig(), prompt);
    assert.equal(decision.action, "ask", prompt);
    assert.equal(decision.identity, null, prompt);
    assert.ok(decision.reasonCodes.includes("AMBIGUOUS"), prompt);
  }
});

test("explicit Flash conflicts with high risk and asks", () => {
  const decision = evaluatePrompt(semiConfig(), "use flash to migrate the production database");
  assert.equal(decision.action, "ask");
  assert.equal(decision.identity, null);
  assert.ok(decision.reasonCodes.includes("EXPLICIT_CONFLICT"));
});

test("images are not silently routed when the task is risky or unrelated", () => {
  const risky = evaluatePrompt(semiConfig(), "По скриншоту оцени уязвимость аутентификации в проде");
  assert.equal(risky.action, "ask");
  assert.ok(risky.reasonCodes.includes("IMAGE_AND_RISK"));

  const attached = evaluatePrompt(semiConfig(), "Исправь опечатку в заголовке", {
    images: [{ mime: "image/png" }],
  });
  assert.equal(attached.action, "ask");
  assert.ok(attached.reasonCodes.includes("IMAGE_WITH_OTHER_TASK"));

  const visual = evaluatePrompt(semiConfig(), "Что на этом скриншоте?");
  assert.equal(visual.action, "recommend");
  assert.equal(visual.identity.key, "zai-subscription::GLM-5.3-Flash");
  assert.ok(visual.reasonCodes.includes("IMAGE_FLASH_DOC"));
});

test("duplicate GLM names stay on the subscription unless OpenRouter is explicitly named", () => {
  const config = allowOpenrouter(semiConfig());
  const bare = evaluatePrompt(config, "Use GLM-5.3 for this typo fix");
  assert.equal(bare.identity.provider, "zai-subscription");
  assert.equal(bare.identity.key, "zai-subscription::GLM-5.3");
  assert.equal(bare.openrouter.selected, false);
  assert.equal(bare.openrouter.excludedDuplicate, true);

  const named = evaluatePrompt(config, "Use OpenRouter model z-ai/glm-5.3");
  assert.equal(named.action, "recommend");
  assert.equal(named.identity.key, "openrouter::z-ai/glm-5.3");
  assert.equal(named.identity.provider, "openrouter");
  assert.notEqual(named.identity.key, bare.identity.key);
  assert.equal(named.execution.invokedModel, false);
  assert.equal(named.execution.orchestration, "disabled");
});

test("OpenRouter off, missing cap, over cap and exhausted quota do not fall back", () => {
  const off = semiConfig();
  const denied = evaluatePrompt(off, "Use OpenRouter model z-ai/glm-5.3");
  assert.equal(denied.action, "ask");
  assert.equal(denied.identity, null);
  assert.ok(denied.reasonCodes.includes("OPENROUTER_DISABLED"));
  assert.ok(denied.reasonCodes.includes("OPENROUTER_OFF_NO_SUBSTITUTE"));

  const noCap = semiConfig();
  noCap.providers.openrouter.enabled = true;
  const missing = evaluatePrompt(noCap, "через опенроутер z-ai/glm-5.3");
  assert.equal(missing.identity, null);
  assert.ok(missing.reasonCodes.includes("SPENDING_CAP_MISSING"));

  const expensive = allowOpenrouter(semiConfig(), "z-ai/glm-5.3", 5, 1);
  const over = evaluatePrompt(expensive, "OpenRouter z-ai/glm-5.3");
  assert.equal(over.identity, null);
  assert.ok(over.reasonCodes.includes("PRICE_OVER_CAP"));

  const exhausted = allowOpenrouter(semiConfig());
  exhausted.quota.declaredState = "exhausted";
  const blocked = evaluatePrompt(exhausted, "OpenRouter z-ai/glm-5.3 исправь опечатку");
  assert.equal(blocked.action, "blocked");
  assert.equal(blocked.identity, null);
  assert.equal(blocked.openrouter.selected, false);
  assert.ok(blocked.reasonCodes.includes("QUOTA_EXHAUSTED"));
  const text = renderDecision(blocked);
  assert.equal(text.includes("z-ai/glm-5.3"), false);
  assert.match(text, /не предлагается/);
});

test("global off overrides an enabled OpenRouter provider", () => {
  resetSignalStats();
  const config = allowOpenrouter(defaultConfig());
  assert.equal(config.mode, "off");
  assert.equal(config.providers.openrouter.enabled, true);
  const decision = evaluatePrompt(config, "OpenRouter z-ai/glm-5.3");
  assert.equal(decision.type, "passthrough");
  assert.equal(signalStats.calls, 0);
});

test("auto-subtasks stays advisory and does not delegate uncertain or paid routes", () => {
  const config = semiConfig();
  config.mode = "experimental-auto-subtasks";
  const clear = evaluatePrompt(config, "Fix the typo in the title");
  assert.equal(clear.execution.orchestration, "advisory-best-effort");
  assert.equal(clear.execution.invokedModel, false);
  assert.match(renderDecision(clear), /best-effort/);

  const unsure = evaluatePrompt(config, "make it better");
  assert.equal(unsure.action, "ask");
  assert.equal(unsure.execution.orchestration, "disabled");

  const paid = allowOpenrouter(config);
  const named = evaluatePrompt(paid, "OpenRouter z-ai/glm-5.3");
  assert.equal(named.identity.provider, "openrouter");
  assert.equal(named.execution.orchestration, "disabled");
});

test("longer than the Flash threshold but not a long context asks", () => {
  const config = semiConfig();
  config.heuristics.flashMaxChars = 40;
  config.heuristics.longContextChars = 400;
  const decision = evaluatePrompt(config, "Fix the typo in the title of this slightly longer note");
  assert.equal(decision.action, "ask");
  assert.ok(decision.reasonCodes.includes("LENGTH_OVER_FLASH"));
});

test("rendered advice does not quote the raw prompt", () => {
  const token = "UNIQUE_PROMPT_TOKEN_9f3a";
  const decision = evaluatePrompt(semiConfig(), `Исправь опечатку ${token}`);
  assert.equal(renderDecision(decision).includes(token), false);
});
