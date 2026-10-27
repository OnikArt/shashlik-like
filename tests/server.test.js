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
  assert.ok(body.products.every((product) => Array.isArray(product.modifierGroupIds)));
  assert.ok(body.products.every((product) => typeof product.freeOnionEnabled === "boolean"));
  assert.ok(Array.isArray(body.modifierGroups));
});

test("modifier groups are managed by admin and exposed to the storefront", async () => {
  const token = await login();
  const headers = { "content-type": "application/json", authorization: "Bearer " + token };
  const created = await request("/api/admin/modifier-groups", { method: "POST", headers, body: JSON.stringify({ name: "Тестовый выбор", selection: "single", required: true, options: [{ name: "Первый", price: 0, isActive: true, defaultSelected: true }] }) });
  assert.equal(created.response.status, 201);
  const product = await request("/api/admin/products", { method: "POST", headers, body: JSON.stringify({ name: "Тест модификаторов", slug: "test-modifiers", description: "Тест", price: 100, unit: "1 шт", step: 1, categoryId: "shashlik", imageUrl: "/assets/placeholder.svg", images: ["/assets/placeholder.svg"], isActive: true, isAvailable: true, modifierGroupIds: [created.body.group.id], freeOnionEnabled: true }) });
  assert.equal(product.response.status, 201);
  const invalidOrder = await request("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customerName: "Тест", phone: "+7 900 000-00-00", deliveryType: "delivery", address: "ул. Ленина, 1", items: [{ productId: product.body.product.id, quantity: 1, addons: [], onionChoice: "with", modifiers: [{ groupId: created.body.group.id, optionIds: [] }] }] }) });
  assert.equal(invalidOrder.response.status, 400);
  const validOrder = await request("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customerName: "Тест", phone: "+7 900 000-00-00", deliveryType: "delivery", address: "ул. Ленина, 1", items: [{ productId: product.body.product.id, quantity: 1, addons: [], onionChoice: "without", modifiers: [{ groupId: created.body.group.id, optionIds: [created.body.group.options[0].id] }] }] }) });
  assert.equal(validOrder.response.status, 201);
  const catalog = await request("/api/bootstrap");
  assert.ok(catalog.body.modifierGroups.some((group) => group.id === created.body.group.id));
  const removed = await request(`/api/admin/modifier-groups/${created.body.group.id}`, { method: "DELETE", headers });
  assert.equal(removed.response.status, 200);
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

test("owner can configure personal Telegram event filters and create a one-time group command", async () => {
  const token = await login();
  const headers = { "content-type": "application/json", authorization: "Bearer " + token };
  const updated = await request("/api/admin/telegram/users/owner", {
    method: "PUT",
    headers,
    body: JSON.stringify({ isActive: false, events: ["new_order", "staff_changes", "unknown_event"] })
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.user.telegramNotificationsEnabled, false);
  assert.deepEqual(updated.body.user.telegramEvents, ["new_order", "staff_changes"]);

  const link = await request("/api/admin/telegram/group-link", { method: "POST", headers, body: "{}" });
  assert.equal(link.response.status, 201);
  assert.match(link.body.command, /^\/connectgroup [A-F0-9]{12}$/);

  const admin = await request("/api/admin/bootstrap", { headers: { authorization: "Bearer " + token } });
  const owner = admin.body.users.find((user) => user.id === "owner");
  assert.equal(owner.telegramNotificationsEnabled, false);
  assert.deepEqual(owner.telegramEvents, ["new_order", "staff_changes"]);
  assert.equal("telegramGroupLinks" in admin.body, false);
});

test("settings and per-kiosk aggregator links persist and are exposed publicly", async () => {
  const token = await login();
  const headers = { "content-type": "application/json", authorization: "Bearer " + token };
  const settingsResult = await request("/api/admin/settings", {
    method: "PUT",
    headers,
    body: JSON.stringify({
      secondaryPhone1: "+7 900 123-45-67",
      ownerTelegram: "@owner_test",
      minOrderAmount: 700,
      maxOrderAmount: 15000,
      maxUrl: "https://max.ru/shashlik-like"
    })
  });
  assert.equal(settingsResult.response.status, 200);
  const admin = await request("/api/admin/bootstrap", { headers: { authorization: "Bearer " + token } });
  const point = admin.body.pickupPoints[0];
  const pointResult = await request("/api/admin/pickup-points/" + encodeURIComponent(point.id), {
    method: "PUT",
    headers,
    body: JSON.stringify({ yandexFoodUrl: "https://eda.yandex.ru/place/test", deliveryClubUrl: "https://market-delivery.yandex.ru/test" })
  });
  assert.equal(pointResult.response.status, 200);
  const publicResult = await request("/api/bootstrap");
  assert.equal(publicResult.body.settings.secondaryPhone1, "+7 900 123-45-67");
  assert.equal(publicResult.body.settings.minOrderAmount, 700);
  assert.equal(publicResult.body.pickupPoints[0].yandexFoodUrl, "https://eda.yandex.ru/place/test");
});

test("unsafe kiosk links are rejected", async () => {
  const token = await login();
  const admin = await request("/api/admin/bootstrap", { headers: { authorization: "Bearer " + token } });
  const result = await request("/api/admin/pickup-points/" + encodeURIComponent(admin.body.pickupPoints[0].id), {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: "Bearer " + token },
    body: JSON.stringify({ mapUrl: "javascript:alert(1)" })
  });
  assert.equal(result.response.status, 500);
  assert.match(result.body.error, /http/i);
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
