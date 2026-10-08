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
        paymentMethod: "TRANSFER_ON_DELIVERY",
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
    assert.match(tracking.order.address, /Ленина, 12/i);
    assert.match(tracking.order.items[0].imageUrl, /^\/assets\//);
    assert.equal(tracking.order.paymentMethod, "TRANSFER_ON_DELIVERY");
    assert.equal(tracking.order.canReview, false);

    const earlyReviewResponse = await fetch(baseUrl + "/api/orders/track/" + created.order.trackingToken + "/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating: 5, comment: "Отлично" })
    });
    assert.equal(earlyReviewResponse.status, 409);

    const loginResponse = await fetch(baseUrl + "/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "admin", password: "test-admin-password" })
    });
    const login = await loginResponse.json();
    assert.equal(loginResponse.status, 200);

    const adminHeaders = { "content-type": "application/json", authorization: "Bearer " + login.token };
    const adminRequest = async (url, method, body) => {
      const response = await fetch(baseUrl + url, { method, headers: adminHeaders, body: body === undefined ? undefined : JSON.stringify(body) });
      return { response, body: await response.json() };
    };
    const categoryCreated = await adminRequest("/api/admin/categories", "POST", { name: "Тестовая категория", minPrice: "от 100 ₽", sortOrder: 50, isActive: true });
    assert.equal(categoryCreated.response.status, 201);
    const addonCreated = await adminRequest("/api/admin/addons", "POST", { name: "Тестовый соус", price: 25, group: "Соусы", isActive: true, isCustomerVisible: true });
    assert.equal(addonCreated.response.status, 201);
    const productCreated = await adminRequest("/api/admin/products", "POST", { name: "Тестовый товар", slug: "test-product", description: "Для E2E", price: 100, unit: "1 шт", step: 1, categoryId: categoryCreated.body.category.id, imageUrl: "/assets/placeholder.svg", isActive: true, isAvailable: true, isFeatured: false, addonIds: [addonCreated.body.addon.id], sortOrder: 50 });
    assert.equal(productCreated.response.status, 201);
    const pointCreated = await adminRequest("/api/admin/pickup-points", "POST", { name: "Тестовая точка", address: "Воронеж", hours: "09:00–22:00", isActive: true });
    assert.equal(pointCreated.response.status, 201);
    const userCreated = await adminRequest("/api/admin/users", "POST", { login: "e2e-user", password: "temporary-password", firstName: "Тест", lastName: "Сотрудник", role: "EMPLOYEE", isActive: true });
    assert.equal(userCreated.response.status, 201);

    const productUpdated = await adminRequest(`/api/admin/products/${productCreated.body.product.id}`, "PUT", { price: 125 });
    assert.equal(productUpdated.body.product.price, 125);
    const categoryBlocked = await adminRequest(`/api/admin/categories/${categoryCreated.body.category.id}`, "DELETE");
    assert.equal(categoryBlocked.response.status, 409);
    assert.equal((await adminRequest(`/api/admin/users/${userCreated.body.user.id}`, "DELETE")).response.status, 200);
    assert.equal((await adminRequest(`/api/admin/pickup-points/${pointCreated.body.point.id}`, "DELETE")).response.status, 200);
    assert.equal((await adminRequest(`/api/admin/products/${productCreated.body.product.id}`, "DELETE")).response.status, 200);
    assert.equal((await adminRequest(`/api/admin/categories/${categoryCreated.body.category.id}`, "DELETE")).response.status, 200);
    assert.equal((await adminRequest(`/api/admin/addons/${addonCreated.body.addon.id}`, "DELETE")).response.status, 200);

    const adminResponse = await fetch(baseUrl + "/api/admin/bootstrap", { headers: { authorization: "Bearer " + login.token } });
    const admin = await adminResponse.json();
    const savedOrder = admin.orders.find((order) => order.orderNumber === created.order.orderNumber);
    assert.ok(savedOrder);

    let expectedStatus = "new";
    for (const status of ["accepted", "preparing", "ready", "delivering", "completed"]) {
      const statusResponse = await fetch(baseUrl + "/api/admin/orders/" + savedOrder.id, {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: "Bearer " + login.token },
        body: JSON.stringify({ status, expectedStatus })
      });
      assert.equal(statusResponse.status, 200);
      expectedStatus = status;
    }

    const reviewResponse = await fetch(baseUrl + "/api/orders/track/" + created.order.trackingToken + "/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating: 5, comment: "Отличный заказ" })
    });
    const reviewed = await reviewResponse.json();
    assert.equal(reviewResponse.status, 201);
    assert.equal(reviewed.order.review.rating, 5);
    assert.equal(reviewed.order.canReview, false);

    const duplicateReviewResponse = await fetch(baseUrl + "/api/orders/track/" + created.order.trackingToken + "/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating: 4, comment: "Повтор" })
    });
    assert.equal(duplicateReviewResponse.status, 409);
  } finally {
    if (!child.killed) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await rm(directory, { recursive: true, force: true });
  }
});
