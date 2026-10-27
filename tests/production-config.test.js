import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

function runServerWithEnvironment(overrides) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["server/server.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "4987",
        ADMIN_PASSWORD: "test-admin-password",
        ADMIN_TOKEN_SECRET: "test-admin-token-secret-with-more-than-32-characters",
        PUBLIC_SITE_URL: "https://shashlik-like.layero.app",
        TELEGRAM_DISABLED: "true",
        TELEGRAM_POLLING_ENABLED: "false",
        ...overrides
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output }));
  });
}

test("production rejects a missing ADMIN_TOKEN_SECRET before accepting traffic", async () => {
  const result = await runServerWithEnvironment({ ADMIN_TOKEN_SECRET: "" });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /ADMIN_TOKEN_SECRET must contain at least 32 characters/);
});

test("production rejects PUBLIC_SITE_URL without a URL scheme", async () => {
  const result = await runServerWithEnvironment({ PUBLIC_SITE_URL: "shashlik-like.layero.app" });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /PUBLIC_SITE_URL must be a full URL including http:\/\/ or https:\/\//);
});

test("production refuses ephemeral file storage", async () => {
  const result = await runServerWithEnvironment({ LAYERO_DATABASE_URL: "", DATABASE_URL: "" });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /Persistent PostgreSQL is required in production/);
});
