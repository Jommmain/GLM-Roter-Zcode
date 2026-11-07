#!/usr/bin/env node
import { MAX_STDIN_BYTES, MODES, QUOTA_STATES, defaultConfig } from "../lib/constants.mjs";
import { ConfigError, loadConfig, saveConfig, validateConfig } from "../lib/config.mjs";
import { evaluatePrompt } from "../lib/policy.mjs";
import { checkPackage } from "../lib/package-check.mjs";
import { renderDecision, renderStatus } from "../lib/render.mjs";

const argv = process.argv.slice(2);
const command = argv[0];

try {
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  if (command === "status") {
    const loaded = loadConfig();
    if (hasFlag(argv, "--json")) {
      process.stdout.write(`${JSON.stringify(statusJson(loaded))}\n`);
    } else {
      process.stdout.write(`${renderStatus(loaded)}\n`);
    }
    process.exit(loaded.ok ? 0 : 1);
  }
  if (command === "path") {
    const loaded = loadConfig();
    process.stdout.write(`${loaded.file || ""}\n`);
    process.exit(0);
  }
  if (command === "validate") {
    const loaded = loadConfig();
    if (!loaded.ok) {
      process.stderr.write(`${formatErrors(loaded.errors)}\n`);
      process.exit(1);
    }
    process.stdout.write("glm-router: конфиг принят\n");
    process.exit(0);
  }
  if (command === "check-package") {
    const result = checkPackage();
    if (!result.ok) {
      process.stderr.write(`${result.errors.join("\n")}\n`);
      process.exit(1);
    }
    process.stdout.write("glm-router: пакет соответствует локальной схеме\n");
    process.exit(0);
  }
  if (command === "mode") {
    const mode = argv[1];
    if (!MODES.includes(mode)) usageExit("режим: off, semi или experimental-auto-subtasks");
    const config = loadMutable();
    config.mode = mode;
    const file = saveConfig(config);
    process.stdout.write(`режим: ${mode}\nконфиг: ${file}\n`);
    process.exit(0);
  }
  if (command === "openrouter") {
    const toggle = argv[1];
    if (toggle !== "on" && toggle !== "off") usageExit("openrouter on или openrouter off");
    const config = loadMutable();
    config.providers.openrouter.enabled = toggle === "on";
    const file = saveConfig(config);
    process.stdout.write(`OpenRouter: ${toggle === "on" ? "ВКЛ" : "ВЫКЛ"}\nконфиг: ${file}\n`);
    if (toggle === "on") {
      process.stdout.write("Включение не добавляет модели и не задаёт лимит. Платный маршрут остаётся закрытым, пока нет списка и лимита.\n");
    }
    process.exit(0);
  }
  if (command === "openrouter-allow") {
    const modelId = flagValue(argv, "--model");
    const usd = flagValue(argv, "--usd");
    const name = flagValue(argv, "--name") || modelId;
    if (!modelId || usd === null) usageExit("openrouter-allow --model ID --usd ЧИСЛО [--name ИМЯ]");
    const declared = Number(usd);
    const config = loadMutable();
    const entry = {
      provider: "openrouter",
      modelId,
      displayName: name,
      declaredUsdPerCall: declared,
      bindingConfirmed: false,
    };
    const next = config.providers.openrouter.allowedModels.filter((item) => item.modelId !== modelId);
    next.push(entry);
    config.providers.openrouter.allowedModels = next;
    const validated = validateConfig(config);
    if (!validated.ok) {
      process.stderr.write(`${formatErrors(validated.errors)}\n`);
      process.exit(1);
    }
    const file = saveConfig(validated.value);
    process.stdout.write(`разрешена модель openrouter::${modelId}\nконфиг: ${file}\n`);
    process.exit(0);
  }
  if (command === "openrouter-disallow") {
    const modelId = flagValue(argv, "--model");
    if (!modelId) usageExit("openrouter-disallow --model ID");
    const config = loadMutable();
    config.providers.openrouter.allowedModels = config.providers.openrouter.allowedModels.filter((item) => item.modelId !== modelId);
    const file = saveConfig(config);
    process.stdout.write(`модель убрана из списка OpenRouter: ${modelId}\nконфиг: ${file}\n`);
    process.exit(0);
  }
  if (command === "openrouter-cap") {
    const config = loadMutable();
    if (argv.includes("--clear")) {
      config.providers.openrouter.maxUsdPerRecommendation = null;
    } else {
      const raw = flagValue(argv, "--max-usd");
      if (raw === null) usageExit("openrouter-cap --max-usd ЧИСЛО или --clear");
      config.providers.openrouter.maxUsdPerRecommendation = Number(raw);
    }
    const validated = validateConfig(config);
    if (!validated.ok) {
      process.stderr.write(`${formatErrors(validated.errors)}\n`);
      process.exit(1);
    }
    const file = saveConfig(validated.value);
    process.stdout.write(`лимит OpenRouter обновлён\nконфиг: ${file}\n`);
    process.exit(0);
  }
  if (command === "quota") {
    const state = argv[1];
    if (!QUOTA_STATES.includes(state)) usageExit("quota unknown, exhausted или available");
    const config = loadMutable();
    config.quota.declaredState = state;
    const file = saveConfig(config);
    process.stdout.write(`квота (только локальная отметка, не клиент ZCode): ${state}\nконфиг: ${file}\n`);
    process.exit(0);
  }
  if (command === "binding-confirm" || command === "binding-reset") {
    const role = flagValue(argv, "--role");
    if (role !== "main" && role !== "flash") usageExit(`${command} --role main|flash`);
    const config = loadMutable();
    const model = config.providers.zai_subscription.models[role];
    if (command === "binding-reset") {
      model.bindingConfirmed = false;
      model.modelId = null;
    } else {
      const modelId = flagValue(argv, "--model-id");
      if (modelId !== null) model.modelId = modelId;
      model.bindingConfirmed = true;
    }
    const validated = validateConfig(config);
    if (!validated.ok) {
      process.stderr.write(`${formatErrors(validated.errors)}\n`);
      process.exit(1);
    }
    const file = saveConfig(validated.value);
    process.stdout.write(
      "Локальная подпись обновлена. Плагин по-прежнему не записывает model: и не переключает сессию: квалификация провайдера в документации не подтверждена.\n",
    );
    process.stdout.write(`конфиг: ${file}\n`);
    process.exit(0);
  }
  if (command === "classify") {
    const loaded = loadConfig();
    if (!loaded.ok) {
      process.stderr.write(`${formatErrors(loaded.errors)}\n`);
      process.exit(1);
    }
    if (loaded.config.mode === "off") {
      const payload = { type: "passthrough", mode: "off", classified: false };
      if (hasFlag(argv, "--json")) process.stdout.write(`${JSON.stringify(payload)}\n`);
      else process.stdout.write("режим ВЫКЛ: классификация не выполняется.\n");
      process.exit(0);
    }
    const text = await readClassifyText(argv);
    const decision = evaluatePrompt(loaded.config, text, {});
    if (hasFlag(argv, "--json")) process.stdout.write(`${JSON.stringify(decision)}\n`);
    else if (decision.type === "passthrough") process.stdout.write("классификация пропущена.\n");
    else process.stdout.write(`${renderDecision(decision)}\n`);
    process.exit(0);
  }
  usageExit(`неизвестная команда: ${command}`);
} catch (error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`${formatErrors(error.errors)}\n`);
    process.exit(1);
  }
  process.stderr.write("glm-router: CLI_UNEXPECTED\n");
  process.exit(1);
}

function loadMutable() {
  const loaded = loadConfig();
  if (!loaded.ok) {
    process.stderr.write(`${formatErrors(loaded.errors)}\n`);
    process.exit(1);
  }
  if (!loaded.existed) return defaultConfig();
  return loaded.config;
}

function statusJson(loaded) {
  const openrouter = loaded.config.providers.openrouter;
  return {
    ok: loaded.ok,
    mode: loaded.config.mode,
    openrouterEnabled: openrouter.enabled,
    maxUsdPerRecommendation: openrouter.maxUsdPerRecommendation,
    allowedModels: openrouter.allowedModels.map((item) => ({
      provider: item.provider,
      modelId: item.modelId,
      key: `openrouter::${item.modelId}`,
    })),
    quota: loaded.config.quota.declaredState,
    file: loaded.file,
    via: loaded.via,
    errors: loaded.errors,
    invokedModel: false,
  };
}

async function readClassifyText(args) {
  const textFlag = flagValue(args, "--text");
  const useStdin = args.includes("--stdin");
  if (textFlag !== null && useStdin) usageExit("укажите либо --text, либо --stdin");
  if (textFlag !== null) return textFlag;
  if (!useStdin) usageExit("classify --text ТЕКСТ или classify --stdin");
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_STDIN_BYTES) {
      process.stderr.write("glm-router: STDIN_OVERFLOW\n");
      process.exit(1);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function flagValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function formatErrors(errors) {
  return errors.map((item) => `glm-router: ${item.code} ${item.path}`).join("\n");
}

function usageExit(message) {
  process.stderr.write(`${message}\n${usage()}\n`);
  process.exit(2);
}

function usage() {
  return [
    "glm-router — локальный советник ZCode. Сеть не используется, ключи не читаются.",
    "status [--json] | path | validate | check-package",
    "mode off|semi|experimental-auto-subtasks",
    "openrouter on|off",
    "openrouter-allow --model ID --usd ЧИСЛО [--name ИМЯ]",
    "openrouter-disallow --model ID",
    "openrouter-cap --max-usd ЧИСЛО | --clear",
    "quota unknown|exhausted|available",
    "binding-confirm --role main|flash [--model-id ID]",
    "binding-reset --role main|flash",
    "classify --text ТЕКСТ | --stdin [--json]",
  ].join("\n");
}
