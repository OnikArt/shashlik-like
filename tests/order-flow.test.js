import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(baseUrl + "/api/bootstrap");
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Test API did not start");
}

test("checkout persists before Telegram and exposes a private tracking DTO", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shashlik-like-"));
  const port = 4300 + (process.pid % 500);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_STORE_PATH: path.join(directory, "store.json"),
      TELEGRAM_DISABLED: "true",
      ADMIN_PASSWORD: "test-admin-password"
    },
    stdio: "ignore"
  });

  try {
    await waitForServer(baseUrl);
    const createdResponse = await fetch(baseUrl + "/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerName: "Тестовый заказ",
        phone: "+7 (900) 000-00-00",
        deliveryType: "delivery",
        address: "ул. Ленина, 12",
        items: [{ productId: "pork-neck", quantity: 100, addons: [] }]
      })
    });
    const created = await createdResponse.json();
    assert.equal(createdResponse.status, 201);
    assert.match(created.order.trackingToken, /^[A-Za-z0-9_-]{40,}$/);

    const trackingResponse = await fetch(baseUrl + "/api/orders/track/" + created.order.trackingToken);
    const tracking = await trackingResponse.json();
    assert.equal(trackingResponse.status, 200);
    assert.equal(tracking.order.status, "new");
    assert.equal(tracking.order.publicStatus, "new");
    assert.equal("phone" in tracking.order, false);
    assert.equal("address" in tracking.order, false);
  } finally {
    if (!child.killed) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await rm(directory, { recursive: true, force: true });
  }
});
