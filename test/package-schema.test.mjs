import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { checkPackage } from "../glm-router/lib/package-check.mjs";
import { repoRoot } from "./helpers.mjs";

test("marketplace and plugin match the documented local layout", () => {
  const result = checkPackage(repoRoot());
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("command files do not set a model override", () => {
  const dir = path.join(repoRoot(), "glm-router/commands");
  for (const file of readdirSync(dir)) {
    const text = readFileSync(path.join(dir, file), "utf8");
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatter, file);
    assert.equal(/^model\s*:/m.test(frontmatter[1]), false, file);
  }
});
