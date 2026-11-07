import {
  BYPASS_PREFIX,
  ZAI_PROVIDER,
  identityKey,
} from "./constants.mjs";
import { assertWithinCap, openrouterEligible } from "./config.mjs";
import { detectSignals } from "./signals.mjs";

export function isBypassPrompt(text) {
  if (typeof text !== "string") return false;
  return text.trimStart().startsWith(BYPASS_PREFIX);
}

function base(config, extra = {}) {
  const openrouter = config.providers.openrouter;
  return {
    type: "decision",
    mode: config.mode,
    action: "ask",
    identity: null,
    reasonCodes: [],
    execution: {
      invokedModel: false,
      route: "advisor",
      orchestration: "disabled",
      bindingConfirmed: false,
    },
    openrouter: {
      enabled: openrouter.enabled,
      considered: false,
      eligible: openrouterEligible(config).eligible,
      selected: false,
      excludedDuplicate: false,
    },
    quota: config.quota.declaredState,
    ...extra,
  };
}

function zaiIdentity(config, role) {
  const model = config.providers.zai_subscription.models[role];
  return {
    provider: ZAI_PROVIDER,
    role,
    displayName: model.displayName,
    modelId: null,
    key: identityKey(ZAI_PROVIDER, model.displayName),
    bindingConfirmed: model.bindingConfirmed === true,
  };
}

function applyExecution(config, decision) {
  decision.execution.invokedModel = false;
  const identity = decision.identity;
  if (!identity) {
    decision.execution.route = decision.action === "blocked" ? "blocked" : "advisor";
    decision.execution.orchestration = "disabled";
    decision.execution.bindingConfirmed = false;
    return decision;
  }
  decision.execution.bindingConfirmed = identity.bindingConfirmed === true;
  decision.execution.route = "manual-selector";
  const auto = config.mode === "experimental-auto-subtasks";
  const zaiRecommend = decision.action === "recommend" && identity.provider === ZAI_PROVIDER;
  decision.execution.orchestration = auto && zaiRecommend ? "advisory-best-effort" : "disabled";
  if (!decision.reasonCodes.includes("MANUAL_ONLY")) decision.reasonCodes.push("MANUAL_ONLY");
  if (!decision.reasonCodes.includes("BINDING_UNVERIFIED")) decision.reasonCodes.push("BINDING_UNVERIFIED");
  if (decision.execution.orchestration === "advisory-best-effort") {
    decision.reasonCodes.push("AUTO_ADVISORY");
  }
  return decision;
}

function withQuotaNote(config, decision) {
  if (config.quota.declaredState === "unknown" && decision.action !== "blocked") {
    if (!decision.reasonCodes.includes("QUOTA_UNKNOWN")) decision.reasonCodes.push("QUOTA_UNKNOWN");
  }
  if (!decision.reasonCodes.includes("HEURISTIC_NOTE") && decision.action !== "blocked") {
    decision.reasonCodes.push("HEURISTIC_NOTE");
  }
  return applyExecution(config, decision);
}

function recommendZai(config, role, codes, openrouterMeta = {}) {
  const decision = base(config);
  decision.action = "recommend";
  decision.identity = zaiIdentity(config, role);
  decision.reasonCodes = [...codes, "DUPLICATE_EXCLUDED"];
  decision.openrouter.considered = config.providers.openrouter.enabled;
  decision.openrouter.selected = false;
  decision.openrouter.excludedDuplicate = true;
  Object.assign(decision.openrouter, openrouterMeta);
  return withQuotaNote(config, decision);
}

function ask(config, codes, openrouterMeta = {}) {
  const decision = base(config);
  decision.action = "ask";
  decision.identity = null;
  decision.reasonCodes = codes;
  Object.assign(decision.openrouter, openrouterMeta);
  return withQuotaNote(config, decision);
}

export function evaluatePrompt(config, prompt, extras = {}) {
  if (config.mode === "off") {
    return { type: "passthrough", mode: "off", bypass: false };
  }
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return { type: "passthrough", mode: config.mode, bypass: false, diagnostic: "EMPTY_PROMPT" };
  }
  if (isBypassPrompt(prompt)) {
    return { type: "passthrough", mode: config.mode, bypass: true };
  }
  if (config.providers.zai_subscription.enabled !== true) {
    return ask(config, ["ZAI_DISABLED"]);
  }

  const signals = detectSignals(prompt, extras, config.heuristics);
  if (config.quota.declaredState === "exhausted") {
    const decision = base(config);
    decision.action = "blocked";
    decision.identity = null;
    decision.reasonCodes = ["QUOTA_EXHAUSTED"];
    decision.openrouter.considered = false;
    decision.openrouter.selected = false;
    decision.execution.route = "blocked";
    return applyExecution(config, decision);
  }

  if (hasOpenrouterIntent(prompt, config)) {
    return decideOpenrouter(config, prompt, signals);
  }
  return decideZai(config, signals);
}

function hasOpenrouterIntent(prompt, config) {
  if (mentions(prompt)) return true;
  return config.providers.openrouter.allowedModels.some((entry) => idMentioned(prompt, entry.modelId));
}

function mentions(prompt) {
  return /open\s*router|опенроутер|опенрутер/iu.test(prompt);
}

function decideOpenrouter(config, prompt, signals) {
  const meta = { considered: true, selected: false, excludedDuplicate: false };
  if (!config.providers.openrouter.enabled) {
    return ask(config, ["OPENROUTER_DISABLED", "OPENROUTER_OFF_NO_SUBSTITUTE"], meta);
  }
  const gate = openrouterEligible(config);
  if (!gate.eligible) {
    return ask(config, [gate.code, "OPENROUTER_OFF_NO_SUBSTITUTE"], meta);
  }
  const matches = matchingAllowlist(prompt, config.providers.openrouter.allowedModels);
  if (matches.length === 0) {
    return ask(config, ["MODEL_REQUIRED"], meta);
  }
  if (matches.length > 1) {
    return ask(config, ["AMBIGUOUS_OPENROUTER"], meta);
  }
  const entry = matches[0];
  const price = assertWithinCap(entry, config);
  if (!price.ok) return ask(config, [price.code], meta);
  const decision = base(config);
  decision.action = "recommend";
  decision.identity = {
    provider: "openrouter",
    role: "openrouter-allowed",
    displayName: entry.displayName,
    modelId: entry.modelId,
    key: identityKey("openrouter", entry.modelId),
    bindingConfirmed: entry.bindingConfirmed === true,
    declaredUsdPerCall: entry.declaredUsdPerCall,
  };
  decision.reasonCodes = ["CAP_OK", "MANUAL_ONLY", "BINDING_UNVERIFIED"];
  if (signals.highRisk || signals.multiStep) decision.reasonCodes.push("HIGH_RISK");
  decision.openrouter.considered = true;
  decision.openrouter.selected = true;
  decision.openrouter.excludedDuplicate = false;
  return withQuotaNote(config, decision);
}

function matchingAllowlist(prompt, models) {
  const byId = models.filter((entry) => idMentioned(prompt, entry.modelId));
  if (byId.length > 0) return byId;
  if (!mentions(prompt)) return [];
  const byName = models.filter((entry) => containsDisplayName(prompt, entry.displayName));
  byName.sort((a, b) => b.displayName.length - a.displayName.length);
  if (byName.length === 0) return [];
  const longest = byName[0].displayName.length;
  return byName.filter((entry) => entry.displayName.length === longest);
}

function idMentioned(text, modelId) {
  let from = 0;
  while (from <= text.length) {
    const index = text.indexOf(modelId, from);
    if (index < 0) return false;
    const after = text[index + modelId.length] || "";
    if (!after || !/[A-Za-z0-9._:-]/.test(after)) return true;
    from = index + modelId.length;
  }
  return false;
}

function containsDisplayName(text, name) {
  const haystack = text.toLowerCase();
  const needle = name.toLowerCase();
  const index = haystack.indexOf(needle);
  if (index < 0) return false;
  const after = haystack[index + needle.length] || "";
  if (needle === "glm-5.3" && after === "-") return false;
  return true;
}

function decideZai(config, signals) {
  if (signals.explicit === "flash") {
    if (signals.highRisk || signals.multiStep || signals.long) {
      return ask(config, ["EXPLICIT_CONFLICT", "EXPLICIT_FLASH"]);
    }
    return recommendZai(config, "flash", ["EXPLICIT_FLASH"]);
  }
  if (signals.explicit === "main") {
    return recommendZai(config, "main", ["EXPLICIT_MAIN"]);
  }
  if (signals.image && (signals.highRisk || signals.multiStep)) {
    return ask(config, ["IMAGE_AND_RISK"]);
  }
  if (signals.image && signals.attachmentImage && !signals.boundedVisual) {
    return ask(config, ["IMAGE_WITH_OTHER_TASK"]);
  }
  if (signals.image && !signals.boundedVisual) {
    return ask(config, ["IMAGE_UNCLEAR"]);
  }
  if (signals.image && signals.boundedVisual && !signals.highRisk && !signals.multiStep && !signals.long) {
    return recommendZai(config, "flash", ["IMAGE_FLASH_DOC"]);
  }
  if (signals.bounded && (signals.highRisk || signals.multiStep)) {
    return ask(config, ["RISK_AND_SIMPLE"]);
  }
  if (signals.highRisk || signals.multiStep || signals.long) {
    const codes = [];
    if (signals.highRisk) codes.push("HIGH_RISK");
    if (signals.multiStep) codes.push("MULTI_STEP");
    if (signals.long) codes.push("LONG_CONTEXT");
    return recommendZai(config, "main", codes);
  }
  if (signals.bounded && signals.overFlash) return ask(config, ["LENGTH_OVER_FLASH"]);
  if (signals.bounded) return recommendZai(config, "flash", ["BOUNDED_LOW_RISK"]);
  return ask(config, ["AMBIGUOUS"]);
}
