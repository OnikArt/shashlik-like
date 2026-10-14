import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const adminPassword = "test-admin-password";
const port = 4800 + (process.pid % 500);
const baseUrl = `http://127.0.0.1:${port}`;
let directory;
let child;
let serverOutput = "";

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child?.exitCode !== null) throw new Error("Test API stopped before it became ready:\n" + serverOutput);
    try {
      const response = await fetch(baseUrl + "/health");
      if (response.ok) return;
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Test API did not start:\n" + serverOutput);
}

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "shashlik-like-server-"));
  child = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      DATA_STORE_PATH: path.join(directory, "store.json"),
      ADMIN_PASSWORD: adminPassword,
      ADMIN_TOKEN_SECRET: "test-admin-token-secret-with-more-than-32-characters",
      PUBLIC_SITE_URL: baseUrl,
      CORS_ALLOWED_ORIGINS: "http://localhost:5173",
      TELEGRAM_DISABLED: "true",
      TELEGRAM_POLLING_ENABLED: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
  await waitForServer();
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function request(path, init = {}) {
  const response = await fetch(baseUrl + path, init);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function login() {
  const result = await request("/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: "admin", password: adminPassword })
  });
  assert.equal(result.response.status, 200);
  return result.body.token;
}

test("health endpoints confirm that the service, frontend and store are available", async () => {
  for (const pathName of ["/health", "/api/health"]) {
    const { response, body } = await request(pathName);
    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.checks.frontend, true);
    assert.equal(body.checks.store, true);
  }
});

test("API preflight allows the configured frontend and rejects unknown origins", async () => {
  const allowed = await fetch(baseUrl + "/api/bootstrap", { method: "OPTIONS", headers: { origin: "http://localhost:5173" } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:5173");

  const rejected = await fetch(baseUrl + "/api/bootstrap", { method: "OPTIONS", headers: { origin: "https://unknown.example" } });
  assert.equal(rejected.status, 403);
});

test("public catalog exposes explicit addon assignments", async () => {
  const { response, body } = await request("/api/bootstrap");
  assert.equal(response.status, 200);
  assert.ok(body.products.length > 0);
  assert.ok(body.products.every((product) => Array.isArray(product.addonIds)));
});

test("invalid tracking token never exposes an order", async () => {
  const { response, body } = await request("/api/orders/track/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(response.status, 404);
  assert.equal(body.error, "Заказ не найден");
});

test("last active owner cannot deactivate or demote themself", async () => {
  const token = await login();
  const headers = { "content-type": "application/json", authorization: "Bearer " + token };
  const deactivate = await request("/api/admin/users/owner", {
    method: "PUT",
    headers,
    body: JSON.stringify({ isActive: false })
  });
  assert.equal(deactivate.response.status, 400);
  assert.match(deactivate.body.error, /владельц/i);

  const demote = await request("/api/admin/users/owner", {
    method: "PUT",
    headers,
    body: JSON.stringify({ role: "EMPLOYEE" })
  });
  assert.equal(demote.response.status, 400);
  assert.match(demote.body.error, /владельц/i);
});

test("owner cannot delete their own profile", async () => {
  const token = await login();
  const result = await request("/api/admin/users/owner", {
    method: "DELETE",
    headers: { authorization: "Bearer " + token }
  });
  assert.equal(result.response.status, 400);
});

test("unknown Telegram link code is rejected without creating a user", async () => {
  const token = await login();
  const loginName = "test-" + Date.now();
  const result = await request("/api/admin/users", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify({
      login: loginName,
      password: "temporary-password",
      firstName: "Тест",
      lastName: "Связи",
      role: "EMPLOYEE",
      telegramLinkCode: "DOESNOTEXIST"
    })
  });
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /Telegram|Код/i);
});
test("admin bootstrap does not expose Telegram secrets or one-time links", async () => {
  const token = await login();
  const result = await request("/api/admin/bootstrap", {
    headers: { authorization: "Bearer " + token }
  });
  assert.equal(result.response.status, 200);
  assert.equal("telegramLinks" in result.body, false);
  assert.equal("telegramUpdateOffset" in result.body, false);
  assert.equal("telegramOutbox" in result.body, false);
  assert.ok(result.body.users.every((user) => !user.telegramUserId && !user.telegramUsername));
  assert.ok(result.body.users.every((user) => !user.telegramChatId || user.telegramChatId === "connected"));
  assert.ok(result.body.orderStatuses.includes("preparing"));
  assert.ok(result.body.permissions.includes("orders.change_status"));
  assert.equal("analyticsEvents" in result.body, false);
  assert.ok(result.body.analyticsSummary);
});

test("private tracking DTO exposes order details but hides customer identity", async () => {
  const token = await login();
  const admin = await request("/api/admin/bootstrap", { headers: { authorization: "Bearer " + token } });
  const order = admin.body.orders[0];
  if (!order) return;
  const result = await request("/api/orders/track/" + order.trackingToken);
  assert.equal(result.response.status, 200);
  assert.equal("phone" in result.body.order, false);
  assert.equal("customerName" in result.body.order, false);
  assert.equal(typeof result.body.order.address, "string");
  assert.equal(result.body.order.publicStatus, result.body.order.status);
});

test("sitemap excludes private routes", async () => {
  const response = await fetch(baseUrl + "/sitemap.xml");
  const xml = await response.text();
  assert.equal(response.status, 200);
  assert.match(xml, /<urlset/);
  assert.doesNotMatch(xml, /\/admin|\/order\//);
});
