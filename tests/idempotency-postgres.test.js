import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";

const databaseUrl = process.env.SHASHLIK_TEST_DATABASE_URL || "";
const expectedDataDir = process.env.SHASHLIK_TEST_PG_DATA_DIR || "";

async function waitFor(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch { /* server is starting */ }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Local test server did not start: ${url}`);
}

test("PostgreSQL idempotency survives retries, concurrency and interruption", { skip: !databaseUrl && "Set SHASHLIK_TEST_DATABASE_URL for the isolated test cluster" }, async (t) => {
  const parsed = new URL(databaseUrl);
  assert.match(parsed.pathname, /^\/shashlik_idempotency_test(?:_[a-z0-9]+)?$/);
  assert.match(parsed.searchParams.get("host") || "", /^\/private\/tmp\/shashlik-idempotency\.[^/]+\/socket$/);
  assert.ok(expectedDataDir.startsWith("/private/tmp/shashlik-idempotency."));
  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: false });
  const identity = await pool.query("SELECT current_database() AS db, inet_server_addr() IS NULL AS socket_only, current_setting('data_directory') AS directory");
  assert.equal(identity.rows[0].db, parsed.pathname.slice(1));
  assert.equal(identity.rows[0].socket_only, true);
  assert.equal(identity.rows[0].directory, expectedDataDir);

  let notificationCount = 0;
  const notificationBodies = [];
  let holdNotification = false;
  let releaseNotification;
  const mock = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    notificationBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
    notificationCount += 1;
    if (holdNotification) await new Promise((resolve) => { releaseNotification = resolve; });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, result: { message_id: notificationCount } }));
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const mockUrl = `http://127.0.0.1:${mock.address().port}`;
  const basePort = 42000 + (process.pid % 5000);
  const urls = [`http://127.0.0.1:${basePort}`, `http://127.0.0.1:${basePort + 1}`];
  const children = urls.map((_, index) => spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(basePort + index),
      LAYERO_DATABASE_URL: databaseUrl,
      DATABASE_URL: databaseUrl,
      DATABASE_SSL: "false",
      TELEGRAM_DISABLED: "false",
      TELEGRAM_POLLING_ENABLED: "false",
      TELEGRAM_API_BASE_URL: mockUrl,
      TELEGRAM_BOT_TOKEN: "isolated-test-token",
      TELEGRAM_CHAT_ID: "9001",
      MAX_DISABLED: "true",
      MAX_BOT_TOKEN: "isolated-test-token",
      MAX_CHAT_ID: "9001",
      ADMIN_PASSWORD: "isolated-test-password"
    },
    stdio: "ignore"
  }));
  const post = async (url, key, payload, options = {}) => {
    const response = await fetch(`${url}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(payload),
      ...options
    });
    return { status: response.status, body: await response.json() };
  };
  const keyCount = async (key) => Number((await pool.query("SELECT count(*)::int AS count FROM order_idempotency WHERE key = $1", [key])).rows[0].count);
  const orderCount = async (key) => {
    const result = await pool.query("SELECT response->'order'->>'orderNumber' AS number FROM order_idempotency WHERE key = $1", [key]);
    if (!result.rowCount) return 0;
    return Number((await pool.query("SELECT count(*)::int AS count FROM app_state, jsonb_array_elements(data->'orders') AS orders WHERE orders->>'orderNumber' = $1", [result.rows[0].number])).rows[0].count);
  };
  try {
    await Promise.all(urls.map(waitFor));
    const bootstrap = await (await fetch(`${urls[0]}/api/bootstrap`)).json();
    const point = bootstrap.pickupPoints.find((entry) => entry.isActive);
    assert.ok(point);
    const payload = (suffix) => ({ customerName: `Тест ${suffix}`, phone: "+7 900 000-00-00", deliveryType: "pickup", pickupPointId: point.id, promoCode: "САЙТ", items: [{ productId: "pork-neck", quantity: 100, addons: [] }] });

    const firstKey = randomUUID();
    const first = await post(urls[0], firstKey, payload("обычный"));
    assert.equal(first.status, 201);
    assert.equal(await keyCount(firstKey), 1);
    assert.equal(await orderCount(firstKey), 1);
    t.diagnostic("sequential replay and conflict passed");
    const notificationsAfterFirst = notificationCount;
    const firstMessages = notificationBodies.filter((body) => String(body.text || "").includes(first.body.order.orderNumber)).length;
    const replay = await post(urls[1], firstKey, payload("обычный"));
    assert.deepEqual(replay, first);
    assert.equal(notificationCount, notificationsAfterFirst);
    assert.equal(notificationBodies.filter((body) => String(body.text || "").includes(first.body.order.orderNumber)).length, firstMessages);
    assert.equal(await orderCount(firstKey), 1);
    const conflict = await post(urls[1], firstKey, payload("другие данные"));
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, "idempotency_conflict");
    const legacyResponse = await fetch(`${urls[0]}/api/orders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload("старый клиент")) });
    assert.equal(legacyResponse.status, 201);
    const loginResponse = await fetch(`${urls[0]}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "admin", password: "isolated-test-password" }) });
    assert.equal(loginResponse.status, 200);
    const { token } = await loginResponse.json();
    const adminResponse = await fetch(`${urls[0]}/api/admin/bootstrap`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(adminResponse.status, 200);
    const admin = await adminResponse.json();
    const savedOrder = admin.orders.find((entry) => entry.orderNumber === first.body.order.orderNumber);
    assert.ok(savedOrder);
    const statusResponse = await fetch(`${urls[0]}/api/admin/orders/${savedOrder.id}`, { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ status: "accepted", expectedStatus: "new" }) });
    assert.equal(statusResponse.status, 200);
    t.diagnostic("legacy checkout and admin status update passed");

    const sameProcessKey = randomUUID();
    const sameProcess = await Promise.all([post(urls[0], sameProcessKey, payload("один процесс")), post(urls[0], sameProcessKey, payload("один процесс"))]);
    assert.equal(sameProcess[0].status, 201);
    assert.deepEqual(sameProcess[1], sameProcess[0]);
    assert.equal(await orderCount(sameProcessKey), 1);

    const crossProcessKey = randomUUID();
    const crossProcess = await Promise.all([post(urls[0], crossProcessKey, payload("два процесса")), post(urls[1], crossProcessKey, payload("два процесса"))]);
    assert.equal(crossProcess[0].status, 201);
    assert.deepEqual(crossProcess[1], crossProcess[0]);
    assert.equal(await orderCount(crossProcessKey), 1);
    t.diagnostic("same-process and cross-process concurrency passed");

    const timeoutKey = randomUUID();
    holdNotification = true;
    const controller = new AbortController();
    const timedOut = post(urls[0], timeoutKey, payload("тайм-аут"), { signal: controller.signal }).catch((error) => error);
    for (let attempt = 0; attempt < 100 && !(await keyCount(timeoutKey)); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(await keyCount(timeoutKey), 1);
    controller.abort();
    await timedOut;
    const afterTimeout = await post(urls[1], timeoutKey, payload("тайм-аут"));
    assert.equal(afterTimeout.status, 201);
    assert.equal(await orderCount(timeoutKey), 1);
    t.diagnostic("network timeout retry passed");
    if (releaseNotification) releaseNotification();
    releaseNotification = undefined;
    holdNotification = false;
    await new Promise((resolve) => setTimeout(resolve, 50));
    const countBeforeCrash = notificationCount;

    const crashKey = randomUUID();
    holdNotification = true;
    const interrupted = post(urls[0], crashKey, payload("прерывание")).catch((error) => error);
    for (let attempt = 0; attempt < 100 && (!(await keyCount(crashKey)) || notificationCount === countBeforeCrash); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(await keyCount(crashKey), 1);
    assert.ok(notificationCount > countBeforeCrash);
    t.diagnostic("crash order committed and mock notification entered");
    const crashNumber = (await pool.query("SELECT response->'order'->>'orderNumber' AS number FROM order_idempotency WHERE key = $1", [crashKey])).rows[0].number;
    const crashMessages = notificationBodies.filter((body) => String(body.text || "").includes(crashNumber)).length;
    children[0].kill("SIGKILL");
    t.diagnostic("first process killed");
    if (releaseNotification) releaseNotification();
    holdNotification = false;
    t.diagnostic("mock notification released");
    const afterCrash = await post(urls[1], crashKey, payload("прерывание"));
    t.diagnostic("replay after process kill returned");
    assert.equal(afterCrash.status, 201);
    assert.equal(await orderCount(crashKey), 1);
    assert.equal(notificationBodies.filter((body) => String(body.text || "").includes(afterCrash.body.order.orderNumber)).length, crashMessages, "replay must not send another notification");
    t.diagnostic("process interruption retry passed");
  } finally {
    if (releaseNotification) releaseNotification();
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await Promise.all(children.map((child) => child.exitCode === null && child.signalCode === null ? new Promise((resolve) => child.once("exit", resolve)) : Promise.resolve()));
    mock.closeAllConnections();
    await Promise.race([new Promise((resolve) => mock.close(resolve)), new Promise((resolve) => setTimeout(resolve, 1000))]);
    await pool.end();
  }
});
