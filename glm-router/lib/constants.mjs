export const PACKAGE_VERSION = "0.1.0";

export const MODES = Object.freeze([
  "off",
  "semi",
  "experimental-auto-subtasks",
]);

export const QUOTA_STATES = Object.freeze([
  "unknown",
  "exhausted",
  "available",
]);

export const ZAI_PROVIDER = "zai-subscription";
export const OPENROUTER_PROVIDER = "openrouter";

export const DEFAULT_MAIN_NAME = "GLM-5.3";
export const DEFAULT_FLASH_NAME = "GLM-5.3-Flash";

export const MAX_STDIN_BYTES = 256 * 1024;
export const MAX_CONFIG_BYTES = 128 * 1024;
export const MAX_MODEL_ID_LENGTH = 200;
export const MAX_ALLOWLIST = 32;
export const MAX_USD = 100_000;

export const BYPASS_PREFIX = "[[glm-router:bypass]]";

export const BARE_GLM_IDS = Object.freeze([
  "glm-5.3",
  "glm-5.3-flash",
  "glm 5.3",
  "glm 5.3 flash",
]);

export const DEFAULT_HEURISTICS = Object.freeze({
  flashMaxChars: 700,
  longContextChars: 2500,
});

export function defaultConfig() {
  return {
    version: 1,
    mode: "off",
    providers: {
      zai_subscription: {
        enabled: true,
        models: {
          main: {
            displayName: DEFAULT_MAIN_NAME,
            modelId: null,
            bindingConfirmed: false,
          },
          flash: {
            displayName: DEFAULT_FLASH_NAME,
            modelId: null,
            bindingConfirmed: false,
          },
        },
      },
      openrouter: {
        enabled: false,
        maxUsdPerRecommendation: null,
        allowedModels: [],
      },
    },
    quota: {
      declaredState: "unknown",
    },
    heuristics: {
      flashMaxChars: DEFAULT_HEURISTICS.flashMaxChars,
      longContextChars: DEFAULT_HEURISTICS.longContextChars,
    },
  };
}

export function identityKey(provider, modelKey) {
  return `${provider}::${modelKey}`;
}

export function isBareGlmId(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return BARE_GLM_IDS.includes(normalized);
}

export function looksSecretLike(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (/^(sk-|sk_|bearer\s+|api[_-]?key\b)/i.test(trimmed)) return true;
  return trimmed.includes("BEGIN ") && trimmed.includes("KEY");
}
