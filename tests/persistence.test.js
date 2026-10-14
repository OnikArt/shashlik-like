import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function startServer(port, storePath) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      DATA_STORE_PATH: storePath,
      ADMIN_PASSWORD: "test-admin-password",
      ADMIN_TOKEN_SECRET: "test-admin-token-secret-with-more-than-32-characters",
      PUBLIC_SITE_URL: baseUrl,
      TELEGRAM_DISABLED: "true",
      TELEGRAM_POLLING_ENABLED: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Persistence test server stopped:\n" + output);
    try {
      const response = await fetch(baseUrl + "/health");
      if (response.ok) return { child, baseUrl };
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill();
  throw new Error("Persistence test server did not start:\n" + output);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

test("an order remains available after restarting with the same data store", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shashlik-like-persistence-"));
  const storePath = path.join(directory, "store.json");
  const port = 5300 + (process.pid % 500);
  let running;
  try {
    running = await startServer(port, storePath);
    const createdResponse = await fetch(running.baseUrl + "/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerName: "Проверка перезапуска",
        phone: "+7 (900) 000-00-02",
        deliveryType: "delivery",
        address: "ул. Тестовая, 1",
        items: [{ productId: "pork-neck", quantity: 100, addons: [] }]
      })
    });
    const created = await createdResponse.json();
    assert.equal(createdResponse.status, 201);
    await stopServer(running.child);

    running = await startServer(port, storePath);
    const trackedResponse = await fetch(running.baseUrl + "/api/orders/track/" + created.order.trackingToken);
    const tracked = await trackedResponse.json();
    assert.equal(trackedResponse.status, 200);
    assert.equal(tracked.order.orderNumber, created.order.orderNumber);
  } finally {
    if (running?.child) await stopServer(running.child);
    await rm(directory, { recursive: true, force: true });
  }
});
