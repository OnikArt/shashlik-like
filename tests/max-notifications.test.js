import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(baseUrl + "/api/bootstrap");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Test API did not start");
}

test("MAX receives a privacy-safe order notification through its official API shape", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shashlik-like-max-"));
  const port = 5000 + (process.pid % 500);
  const requests = [];
  const maxMock = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({
      url: req.url,
      authorization: req.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ body: { mid: "mock-message" } }));
  });
  await new Promise((resolve, reject) => {
    maxMock.once("error", reject);
    maxMock.listen(0, "127.0.0.1", resolve);
  });
  const maxAddress = maxMock.address();
  const child = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      DATA_STORE_PATH: path.join(directory, "store.json"),
      TELEGRAM_DISABLED: "true",
      TELEGRAM_POLLING_ENABLED: "false",
      MAX_DISABLED: "false",
      MAX_BOT_TOKEN: "max-test-token",
      MAX_CHAT_ID: "-100500",
      MAX_API_BASE_URL: `http://127.0.0.1:${maxAddress.port}`,
      ADMIN_PASSWORD: "test-admin-password"
    },
    stdio: "ignore"
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(baseUrl);
    const response = await fetch(baseUrl + "/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerName: "Тестовый клиент",
        phone: "+7 (900) 000-00-00",
        deliveryType: "delivery",
        paymentMethod: "CASH_ON_DELIVERY",
        address: "Тестовая улица, 1",
        items: [{ productId: "pork-neck", quantity: 100, addons: [] }]
      })
    });
    const created = await response.json();
    assert.equal(response.status, 201);
    const notification = requests.find((request) => request.url?.startsWith("/messages?"));
    assert.ok(notification);
    assert.equal(notification.authorization, "max-test-token");
    assert.match(notification.url, /chat_id=-100500/);
    assert.match(notification.body.text, new RegExp(created.order.orderNumber));
    assert.doesNotMatch(notification.body.text, /\+79000000000|Тестовая улица/);
    assert.match(notification.body.text, /админ-панели/);
  } finally {
    child.kill("SIGTERM");
    maxMock.close();
    await rm(directory, { recursive: true, force: true });
  }
});
