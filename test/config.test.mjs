import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { defaultConfig } from "../glm-router/lib/constants.mjs";
import { loadConfig, saveConfig, validateConfig } from "../glm-router/lib/config.mjs";
import { isolatedHome } from "./helpers.mjs";

test("defaults keep OpenRouter off and mode off", () => {
  const config = defaultConfig();
  assert.equal(config.mode, "off");
  assert.equal(config.providers.openrouter.enabled, false);
  assert.equal(config.providers.openrouter.maxUsdPerRecommendation, null);
  assert.deepEqual(config.providers.openrouter.allowedModels, []);
  assert.equal(config.quota.declaredState, "unknown");
});

test("rejects bare duplicate ids, foreign providers, secrets and duplicate allowlist ids", () => {
  const secret = ["sk", "live", "abcdef123456"].join("-");
  const config = defaultConfig();
  config.providers.moonshot = { enabled: true };
  config.providers.openrouter.allowedModels = [
    {
      provider: "zai-subscription",
      modelId: "GLM-5.3",
      displayName: "GLM-5.3",
      declaredUsdPerCall: 1,
      bindingConfirmed: false,
    },
    {
      provider: "openrouter",
      modelId: secret,
      displayName: "secret",
      declaredUsdPerCall: 1,
      bindingConfirmed: false,
    },
  ];
  const result = validateConfig(config);
  assert.equal(result.ok, false);
  const codes = result.errors.map((item) => item.code);
  assert.ok(codes.includes("UNKNOWN_PROVIDER"));
  assert.ok(codes.includes("ALLOWLIST_PROVIDER") || codes.includes("BARE_DUPLICATE_ID"));
  assert.ok(codes.includes("SECRET_LIKE") || codes.includes("BARE_DUPLICATE_ID"));
  assert.equal(JSON.stringify(result.errors).includes(secret), false);
});

test("atomic save does not leave a temp file and refuses .zcode paths", () => {
  const isolated = isolatedHome();
  const config = defaultConfig();
  config.mode = "semi";
  const file = saveConfig(config, isolated.env, isolated.homedir);
  assert.equal(existsSync(file), true);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const leftovers = readFileSync(file, "utf8");
  assert.match(leftovers, /"mode": "semi"/);
  assert.equal(readdirSync(path.dirname(file)).some((name) => name.endsWith(".tmp")), false);
  const forbidden = isolated.env;
  forbidden.GLM_ROUTER_CONFIG_PATH = path.join(isolated.dir, ".zcode", "v2", "config.json");
  assert.throws(() => saveConfig(config, forbidden, isolated.homedir));
});

test("hook ignores a pointer that targets .zcode and does not surface its canary", () => {
  const isolated = isolatedHome();
  delete isolated.env.GLM_ROUTER_CONFIG_PATH;
  const canary = "UNIQUE_ZCODE_CANARY_MODE";
  const zcodeFile = path.join(isolated.dir, ".zcode", "v2", "config.json");
  const pointerDir = path.join(isolated.xdg, "glm-router");
  mkdirSync(path.dirname(zcodeFile), { recursive: true });
  writeFileSync(zcodeFile, JSON.stringify({ version: 1, mode: "semi", canary }));
  mkdirSync(pointerDir, { recursive: true });
  writeFileSync(
    path.join(pointerDir, "active-path.json"),
    JSON.stringify({ version: 1, configPath: zcodeFile }),
  );
  const loaded = loadConfig(isolated.env, isolated.homedir);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.config.mode, "off");
  assert.equal(JSON.stringify(loaded).includes(canary), false);
});
