import assert from "node:assert/strict";
import test from "node:test";
import { scanTree } from "../scripts/security-scan.mjs";

test("shipped tree has no secrets, screenshots, or app credential reads", () => {
  assert.deepEqual(scanTree(), []);
});
