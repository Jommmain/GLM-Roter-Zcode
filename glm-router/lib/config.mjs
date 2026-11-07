import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_ALLOWLIST,
  MAX_CONFIG_BYTES,
  MAX_MODEL_ID_LENGTH,
  MAX_USD,
  MODES,
  OPENROUTER_PROVIDER,
  QUOTA_STATES,
  defaultConfig,
  isBareGlmId,
  looksSecretLike,
} from "./constants.mjs";

export class ConfigError extends Error {
  constructor(errors) {
    super("CONFIG_INVALID");
    this.code = "CONFIG_INVALID";
    this.errors = errors;
  }
}

export function isForbiddenConfigPath(filePath) {
  if (typeof filePath !== "string" || filePath.trim() === "") return true;
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.includes(".zcode")) return true;
  try {
    const resolved = path.resolve(filePath);
    if (resolved.replace(/\\/g, "/").split("/").includes(".zcode")) return true;
    if (existsSync(resolved)) {
      const real = realpathSync(resolved);
      if (real.replace(/\\/g, "/").split("/").includes(".zcode")) return true;
    }
  } catch {
    return true;
  }
  return false;
}

function stateHome(env, homedir) {
  const xdg = env.XDG_DATA_HOME;
  if (typeof xdg === "string" && xdg.trim() !== "") return xdg;
  return path.join(homedir, ".local", "share");
}

export function pointerPath(env, homedir = os.homedir()) {
  return path.join(stateHome(env, homedir), "glm-router", "active-path.json");
}

export function fallbackConfigPath(env, homedir = os.homedir()) {
  return path.join(stateHome(env, homedir), "glm-router", "config.json");
}

export function pluginDataConfigPath(env) {
  if (typeof env.ZCODE_PLUGIN_DATA !== "string" || env.ZCODE_PLUGIN_DATA.trim() === "") {
    return null;
  }
  return path.join(env.ZCODE_PLUGIN_DATA, "glm-router-config.json");
}

function readPointer(env, homedir) {
  const file = pointerPath(env, homedir);
  if (isForbiddenConfigPath(file) || !existsSync(file)) return null;
  let parsed;
  try {
    const size = statSync(file).size;
    if (size > 4096) return { error: "POINTER_INVALID" };
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { error: "POINTER_INVALID" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "POINTER_INVALID" };
  }
  if (parsed.version !== 1 || typeof parsed.configPath !== "string" || !path.isAbsolute(parsed.configPath)) {
    return { error: "POINTER_INVALID" };
  }
  if (isForbiddenConfigPath(parsed.configPath)) return { error: "FORBIDDEN_POINTER" };
  return { configPath: parsed.configPath };
}

export function locateReadableConfig(env, homedir = os.homedir()) {
  if (typeof env.GLM_ROUTER_CONFIG_PATH === "string" && env.GLM_ROUTER_CONFIG_PATH.trim() !== "") {
    if (isForbiddenConfigPath(env.GLM_ROUTER_CONFIG_PATH)) {
      return { file: null, via: "forbidden", diagnostic: "FORBIDDEN_PATH" };
    }
    return { file: env.GLM_ROUTER_CONFIG_PATH, via: "explicit", diagnostic: null };
  }

  const pluginFile = pluginDataConfigPath(env);
  if (pluginFile && isForbiddenConfigPath(pluginFile)) {
    return { file: null, via: "forbidden", diagnostic: "FORBIDDEN_PATH" };
  }
  if (pluginFile && existsSync(pluginFile)) {
    return { file: pluginFile, via: "plugin-data", diagnostic: null };
  }

  const pointer = readPointer(env, homedir);
  if (pointer?.error) {
    return { file: null, via: "pointer", diagnostic: pointer.error };
  }
  if (pointer?.configPath && existsSync(pointer.configPath)) {
    return { file: pointer.configPath, via: "pointer", diagnostic: null };
  }

  if (pluginFile) {
    return { file: pluginFile, via: "plugin-data-missing", diagnostic: null };
  }
  return { file: fallbackConfigPath(env, homedir), via: "fallback", diagnostic: null };
}

export function locateWritableConfig(env, homedir = os.homedir()) {
  if (typeof env.GLM_ROUTER_CONFIG_PATH === "string" && env.GLM_ROUTER_CONFIG_PATH.trim() !== "") {
    if (isForbiddenConfigPath(env.GLM_ROUTER_CONFIG_PATH)) {
      throw new ConfigError([{ code: "FORBIDDEN_PATH", path: "GLM_ROUTER_CONFIG_PATH" }]);
    }
    return env.GLM_ROUTER_CONFIG_PATH;
  }
  const pluginFile = pluginDataConfigPath(env);
  if (pluginFile) {
    if (isForbiddenConfigPath(pluginFile)) {
      throw new ConfigError([{ code: "FORBIDDEN_PATH", path: "ZCODE_PLUGIN_DATA" }]);
    }
    return pluginFile;
  }
  const fallback = fallbackConfigPath(env, homedir);
  if (isForbiddenConfigPath(fallback)) {
    throw new ConfigError([{ code: "FORBIDDEN_PATH", path: "fallback" }]);
  }
  return fallback;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, allowed) {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function push(errors, code, at) {
  errors.push({ code, path: at });
}

export function validateConfig(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ code: "CONFIG_TYPE", path: "$" }], value: null };
  }
  const extra = exactKeys(input, ["version", "mode", "providers", "quota", "heuristics"]);
  for (const key of extra) push(errors, "UNKNOWN_KEY", key);
  if (input.version !== 1) push(errors, "VERSION", "version");
  if (!MODES.includes(input.mode)) push(errors, "MODE", "mode");
  if (!isPlainObject(input.providers)) {
    push(errors, "PROVIDERS", "providers");
  } else {
    const providerExtra = exactKeys(input.providers, ["zai_subscription", "openrouter"]);
    for (const key of providerExtra) push(errors, "UNKNOWN_PROVIDER", `providers.${key}`);
    validateZai(input.providers.zai_subscription, errors);
    validateOpenrouter(input.providers.openrouter, errors);
  }
  if (!isPlainObject(input.quota)) {
    push(errors, "QUOTA", "quota");
  } else {
    const quotaExtra = exactKeys(input.quota, ["declaredState"]);
    for (const key of quotaExtra) push(errors, "UNKNOWN_KEY", `quota.${key}`);
    if (!QUOTA_STATES.includes(input.quota.declaredState)) {
      push(errors, "QUOTA_STATE", "quota.declaredState");
    }
  }
  if (!isPlainObject(input.heuristics)) {
    push(errors, "HEURISTICS", "heuristics");
  } else {
    const heuristicExtra = exactKeys(input.heuristics, ["flashMaxChars", "longContextChars"]);
    for (const key of heuristicExtra) push(errors, "UNKNOWN_KEY", `heuristics.${key}`);
    const flash = input.heuristics.flashMaxChars;
    const long = input.heuristics.longContextChars;
    if (!Number.isInteger(flash) || flash < 50 || flash > 20_000) {
      push(errors, "HEURISTIC_RANGE", "heuristics.flashMaxChars");
    }
    if (!Number.isInteger(long) || long < 51 || long > 200_000) {
      push(errors, "HEURISTIC_RANGE", "heuristics.longContextChars");
    }
    if (Number.isInteger(flash) && Number.isInteger(long) && long <= flash) {
      push(errors, "HEURISTIC_ORDER", "heuristics.longContextChars");
    }
  }
  if (errors.length > 0) return { ok: false, errors, value: null };
  return { ok: true, errors: [], value: input };
}

function validateZai(zai, errors) {
  if (!isPlainObject(zai)) {
    push(errors, "ZAI", "providers.zai_subscription");
    return;
  }
  const extra = exactKeys(zai, ["enabled", "models"]);
  for (const key of extra) push(errors, "UNKNOWN_KEY", `providers.zai_subscription.${key}`);
  if (typeof zai.enabled !== "boolean") push(errors, "ZAI_ENABLED", "providers.zai_subscription.enabled");
  if (!isPlainObject(zai.models)) {
    push(errors, "ZAI_MODELS", "providers.zai_subscription.models");
    return;
  }
  const modelExtra = exactKeys(zai.models, ["main", "flash"]);
  for (const key of modelExtra) push(errors, "UNKNOWN_KEY", `providers.zai_subscription.models.${key}`);
  for (const role of ["main", "flash"]) {
    validateZaiModel(zai.models[role], `providers.zai_subscription.models.${role}`, errors);
  }
}

function validateZaiModel(model, at, errors) {
  if (!isPlainObject(model)) {
    push(errors, "ZAI_MODEL", at);
    return;
  }
  const extra = exactKeys(model, ["displayName", "modelId", "bindingConfirmed"]);
  for (const key of extra) push(errors, "UNKNOWN_KEY", `${at}.${key}`);
  if (typeof model.displayName !== "string" || model.displayName.trim() === "" || model.displayName.length > 120) {
    push(errors, "DISPLAY_NAME", `${at}.displayName`);
  } else if (looksSecretLike(model.displayName)) {
    push(errors, "SECRET_LIKE", `${at}.displayName`);
  }
  if (model.modelId !== null && model.modelId !== undefined) {
    if (typeof model.modelId !== "string" || model.modelId.trim() === "" || model.modelId.length > MAX_MODEL_ID_LENGTH) {
      push(errors, "MODEL_ID", `${at}.modelId`);
    } else if (looksSecretLike(model.modelId)) {
      push(errors, "SECRET_LIKE", `${at}.modelId`);
    }
  }
  if (typeof model.bindingConfirmed !== "boolean") {
    push(errors, "BINDING", `${at}.bindingConfirmed`);
  }
}

function validateOpenrouter(openrouter, errors) {
  if (!isPlainObject(openrouter)) {
    push(errors, "OPENROUTER", "providers.openrouter");
    return;
  }
  const extra = exactKeys(openrouter, ["enabled", "maxUsdPerRecommendation", "allowedModels"]);
  for (const key of extra) push(errors, "UNKNOWN_KEY", `providers.openrouter.${key}`);
  if (typeof openrouter.enabled !== "boolean") {
    push(errors, "OPENROUTER_ENABLED", "providers.openrouter.enabled");
  }
  const cap = openrouter.maxUsdPerRecommendation;
  if (cap !== null && (!Number.isFinite(cap) || cap < 0 || cap > MAX_USD)) {
    push(errors, "SPENDING_CAP", "providers.openrouter.maxUsdPerRecommendation");
  }
  if (!Array.isArray(openrouter.allowedModels) || openrouter.allowedModels.length > MAX_ALLOWLIST) {
    push(errors, "ALLOWLIST", "providers.openrouter.allowedModels");
    return;
  }
  const seen = new Set();
  openrouter.allowedModels.forEach((entry, index) => {
    const at = `providers.openrouter.allowedModels[${index}]`;
    if (!isPlainObject(entry)) {
      push(errors, "ALLOWLIST_ENTRY", at);
      return;
    }
    const entryExtra = exactKeys(entry, [
      "provider",
      "modelId",
      "displayName",
      "declaredUsdPerCall",
      "bindingConfirmed",
    ]);
    for (const key of entryExtra) push(errors, "UNKNOWN_KEY", `${at}.${key}`);
    if (entry.provider !== OPENROUTER_PROVIDER) push(errors, "ALLOWLIST_PROVIDER", `${at}.provider`);
    if (typeof entry.modelId !== "string" || entry.modelId.length === 0 || entry.modelId.length > MAX_MODEL_ID_LENGTH) {
      push(errors, "MODEL_ID", `${at}.modelId`);
    } else if (looksSecretLike(entry.modelId)) {
      push(errors, "SECRET_LIKE", `${at}.modelId`);
    } else if (isBareGlmId(entry.modelId) || !isDistinctOpenrouterId(entry.modelId)) {
      push(errors, "BARE_DUPLICATE_ID", `${at}.modelId`);
    } else if (seen.has(entry.modelId)) {
      push(errors, "DUPLICATE_MODEL_ID", `${at}.modelId`);
    } else {
      seen.add(entry.modelId);
    }
    if (typeof entry.displayName !== "string" || entry.displayName.trim() === "" || entry.displayName.length > 120) {
      push(errors, "DISPLAY_NAME", `${at}.displayName`);
    }
    if (!Number.isFinite(entry.declaredUsdPerCall) || entry.declaredUsdPerCall < 0 || entry.declaredUsdPerCall > MAX_USD) {
      push(errors, "DECLARED_USD", `${at}.declaredUsdPerCall`);
    }
    if (typeof entry.bindingConfirmed !== "boolean") {
      push(errors, "BINDING", `${at}.bindingConfirmed`);
    }
  });
}

export function isDistinctOpenrouterId(modelId) {
  if (typeof modelId !== "string") return false;
  if (isBareGlmId(modelId)) return false;
  return modelId.includes("/") || modelId.toLowerCase().startsWith("openrouter:");
}

export function loadConfig(env = process.env, homedir = os.homedir()) {
  const located = locateReadableConfig(env, homedir);
  if (located.diagnostic && !located.file) {
    return {
      ok: false,
      config: defaultConfig(),
      errors: [{ code: located.diagnostic, path: located.via }],
      via: located.via,
      file: null,
      existed: false,
    };
  }
  const file = located.file;
  if (!file || !existsSync(file)) {
    return {
      ok: true,
      config: defaultConfig(),
      errors: [],
      via: located.via,
      file,
      existed: false,
    };
  }
  if (isForbiddenConfigPath(file)) {
    return {
      ok: false,
      config: defaultConfig(),
      errors: [{ code: "FORBIDDEN_PATH", path: located.via }],
      via: located.via,
      file: null,
      existed: false,
    };
  }
  let raw;
  try {
    const size = statSync(file).size;
    if (size > MAX_CONFIG_BYTES) {
      return {
        ok: false,
        config: defaultConfig(),
        errors: [{ code: "CONFIG_TOO_LARGE", path: located.via }],
        via: located.via,
        file,
        existed: true,
      };
    }
    raw = readFileSync(file, "utf8");
  } catch {
    return {
      ok: false,
      config: defaultConfig(),
      errors: [{ code: "CONFIG_UNREADABLE", path: located.via }],
      via: located.via,
      file,
      existed: true,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      config: defaultConfig(),
      errors: [{ code: "CONFIG_JSON", path: located.via }],
      via: located.via,
      file,
      existed: true,
    };
  }
  const validated = validateConfig(parsed);
  if (!validated.ok) {
    return {
      ok: false,
      config: defaultConfig(),
      errors: validated.errors,
      via: located.via,
      file,
      existed: true,
    };
  }
  return {
    ok: true,
    config: validated.value,
    errors: [],
    via: located.via,
    file,
    existed: true,
  };
}

export function saveConfig(config, env = process.env, homedir = os.homedir()) {
  const validated = validateConfig(config);
  if (!validated.ok) throw new ConfigError(validated.errors);
  const file = locateWritableConfig(env, homedir);
  atomicWriteJson(file, validated.value);
  writePointer(file, env, homedir);
  return file;
}

function writePointer(configFile, env, homedir) {
  const pointer = pointerPath(env, homedir);
  if (isForbiddenConfigPath(pointer) || isForbiddenConfigPath(configFile)) return;
  const absolute = path.resolve(configFile);
  atomicWriteJson(pointer, { version: 1, configPath: absolute });
}

export function atomicWriteJson(file, value) {
  if (isForbiddenConfigPath(file)) {
    throw new ConfigError([{ code: "FORBIDDEN_PATH", path: "file" }]);
  }
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tmp = path.join(directory, `.${path.basename(file)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const json = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(tmp, json, { encoding: "utf8", mode: 0o600 });
  try {
    renameSync(tmp, file);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // The original error is the one that matters.
    }
    throw error;
  }
  return file;
}

export function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

export function openrouterEligible(config) {
  const openrouter = config.providers.openrouter;
  if (!openrouter.enabled) {
    return { eligible: false, code: "OPENROUTER_DISABLED" };
  }
  if (openrouter.maxUsdPerRecommendation === null) {
    return { eligible: false, code: "SPENDING_CAP_MISSING" };
  }
  if (openrouter.allowedModels.length === 0) {
    return { eligible: false, code: "ALLOWLIST_EMPTY" };
  }
  return { eligible: true, code: null };
}

export function assertWithinCap(entry, config) {
  const cap = config.providers.openrouter.maxUsdPerRecommendation;
  if (cap === null || !Number.isFinite(entry.declaredUsdPerCall)) {
    return { ok: false, code: entry.declaredUsdPerCall == null ? "PRICE_UNKNOWN" : "SPENDING_CAP_MISSING" };
  }
  if (entry.declaredUsdPerCall > cap) return { ok: false, code: "PRICE_OVER_CAP" };
  return { ok: true, code: null };
}

