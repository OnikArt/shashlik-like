import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Layero builds once and starts the HTTP process without rebuilding", async () => {
  const layero = JSON.parse(await readFile("layero.json", "utf8"));
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(layero.runtime, "node_web");
  assert.equal(layero.buildCommand, "npm run build");
  assert.equal(layero.startCommand, "node server/server.js");
  assert.equal(packageJson.scripts["start:layero"], "node server/server.js");
  assert.doesNotMatch(layero.startCommand, /build/);
});
