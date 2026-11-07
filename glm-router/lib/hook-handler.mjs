import os from "node:os";
import { isBareGlmId, looksSecretLike } from "./constants.mjs";
import { loadConfig } from "./config.mjs";
import { evaluatePrompt } from "./policy.mjs";
import { renderDecision } from "./render.mjs";

const MODEL_FIELDS = ["model", "modelId", "model_id", "model_name", "modelName"];

export function handleStdinText(raw, env = process.env, homedir = os.homedir()) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return failOpen("STDIN_MALFORMED");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return failOpen("STDIN_MALFORMED");
  }
  try {
    return handleEvent(parsed, env, homedir);
  } catch {
    return failOpen("HOOK_UNEXPECTED");
  }
}

export function handleEvent(event, env = process.env, homedir = os.homedir()) {
  const loaded = loadConfig(env, homedir);
  if (!loaded.ok) {
    return failOpen(loaded.errors.map((item) => item.code).join(","));
  }
  if (loaded.config.mode === "off") {
    return silent();
  }
  const name = event.hook_event_name || event.hookEventName || inferEvent(event);
  if (name === "UserPromptSubmit") return handlePrompt(event, loaded.config);
  if (name === "PreToolUse") return handleTool(event, loaded.config);
  return silent();
}

function handlePrompt(event, config) {
  if (event.prompt !== undefined && typeof event.prompt !== "string") {
    return failOpen("PROMPT_TYPE");
  }
  const decision = evaluatePrompt(config, event.prompt ?? "", {
    attachments: event.attachments,
    images: event.images,
    files: event.files,
  });
  if (decision.type === "passthrough") {
    return {
      exitCode: 0,
      stdout: "",
      stderr: decision.diagnostic ? `glm-router: ${decision.diagnostic}\n` : "",
    };
  }
  const additionalContext = renderDecision(decision);
  return {
    exitCode: 0,
    stdout: `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext,
      },
    })}\n`,
    stderr: "",
  };
}

function handleTool(event, config) {
  const guard = guardTool(config, event.tool_name || event.toolName, event.tool_input ?? event.toolInput);
  if (guard.type === "passthrough") {
    return {
      exitCode: 0,
      stdout: "",
      stderr: guard.diagnostic ? `glm-router: ${guard.diagnostic}\n` : "",
    };
  }
  return {
    exitCode: 0,
    stdout: `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: guard.reason,
      },
    })}\n`,
    stderr: `glm-router: ${guard.code}\n`,
  };
}

export function guardTool(config, toolName, toolInput) {
  if (config.mode === "off") return { type: "passthrough" };
  if (toolName !== "Agent" && toolName !== "Task") return { type: "passthrough" };
  if (toolInput === undefined) return { type: "passthrough" };
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    return { type: "passthrough", diagnostic: "TOOL_INPUT_TYPE" };
  }
  for (const key of MODEL_FIELDS) {
    if (typeof toolInput[key] !== "string") continue;
    const verdict = judgeModelField(config, toolInput[key]);
    if (verdict) return verdict;
  }
  return { type: "passthrough" };
}

function judgeModelField(config, value) {
  const shown = echoable(value);
  if (looksSecretLike(value) || shown === null) {
    return deny("AMBIGUOUS_PROVIDER", "Идентификатор модели отклонён: он неоднозначен или похож на секрет. Выберите модель вручную в селекторе.");
  }
  if (isBareGlmId(value)) {
    return deny(
      "AMBIGUOUS_PROVIDER",
      `Идентификатор «${shown}» совпадает у встроенной подписки и может совпасть с OpenRouter. Провайдер в аргументе инструмента не квалифицирован, вызов остановлен.`,
    );
  }
  const openrouterLike = /open\s*router/i.test(value) || value.toLowerCase().startsWith("openrouter:") || value.includes("z-ai/");
  const allowlist = config.providers.openrouter.allowedModels;
  const listed = allowlist.find((entry) => entry.modelId === value.trim());
  if (!openrouterLike && !listed) return null;
  if (config.quota.declaredState === "exhausted") {
    return deny("QUOTA_NO_FALLBACK", "Квота объявлена исчерпанной. Тихий переход на OpenRouter запрещён.");
  }
  if (!config.providers.openrouter.enabled) {
    return deny("OPENROUTER_DISABLED", "OpenRouter выключен. Вызов с этой моделью остановлен, подстановка другого провайдера не делается.");
  }
  if (!listed) {
    return deny("MODEL_NOT_ALLOWLISTED", "Эта модель OpenRouter не входит в явный список glm-router.");
  }
  const cap = config.providers.openrouter.maxUsdPerRecommendation;
  if (cap === null || !Number.isFinite(listed.declaredUsdPerCall)) {
    return deny("SPENDING_CAP_MISSING", "Для OpenRouter не задан лимит или оценка стоимости. Вызов остановлен.");
  }
  if (listed.declaredUsdPerCall > cap) {
    return deny("PRICE_OVER_CAP", "Заявленная стоимость OpenRouter выше лимита. Вызов остановлен.");
  }
  return null;
}

function echoable(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 120 || /[\r\n]/.test(trimmed) || looksSecretLike(trimmed)) return null;
  return trimmed;
}

function deny(code, reason) {
  return { type: "deny", code, reason };
}

function inferEvent(event) {
  if (typeof event.prompt === "string") return "UserPromptSubmit";
  if (event.tool_name || event.toolName) return "PreToolUse";
  return "";
}

function silent() {
  return { exitCode: 0, stdout: "", stderr: "" };
}

function failOpen(code) {
  return { exitCode: 0, stdout: "", stderr: `glm-router: ${code}\n` };
}
