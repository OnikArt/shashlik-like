import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
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
  const telegramRequests = [];
  let telegramMessageId = 0;
  let failNextTelegramMessage = false;
  const telegramMock = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const method = String(req.url || "").split("/").at(-1);
    telegramRequests.push({ method, body });
    if (method === "sendMessage" && failNextTelegramMessage) {
      failNextTelegramMessage = false;
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, description: "temporary mock failure" }));
      return;
    }
    telegramMessageId += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, result: method === "getUpdates" ? [] : { message_id: telegramMessageId, chat: { id: body.chat_id }, text: body.text || "" } }));
  });
  await new Promise((resolve, reject) => {
    telegramMock.once("error", reject);
    telegramMock.listen(0, "127.0.0.1", resolve);
  });
  const telegramAddress = telegramMock.address();
  const telegramBaseUrl = `http://127.0.0.1:${telegramAddress.port}`;
  const child = spawn(process.execPath, ["server/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_STORE_PATH: path.join(directory, "store.json"),
      TELEGRAM_DISABLED: "false",
      TELEGRAM_POLLING_ENABLED: "false",
      TELEGRAM_API_BASE_URL: telegramBaseUrl,
      TELEGRAM_BOT_TOKEN: "test-token",
      TELEGRAM_CHAT_ID: "1001",
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
    assert.ok(telegramRequests.some((request) => request.method === "sendMessage" && request.body.text.includes(created.order.orderNumber)));

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
    const productCreated = await adminRequest("/api/admin/products", "POST", { name: "Тестовый <товар>", slug: "test-product", description: "Для E2E", price: 100, unit: "1 шт", step: 1, categoryId: categoryCreated.body.category.id, imageUrl: "/assets/placeholder.svg", images: ["/assets/placeholder.svg", "/assets/cinematic-grill-v1.png"], isActive: true, isAvailable: true, isFeatured: false, options: ["Стандартный"], addonIds: [addonCreated.body.addon.id], sortOrder: 50 });
    assert.equal(productCreated.response.status, 201);
    assert.deepEqual(productCreated.body.product.images, ["/assets/placeholder.svg", "/assets/cinematic-grill-v1.png"]);
    assert.ok(telegramRequests.some((request) => request.method === "sendMessage" && request.body.text.includes("ДОБАВЛЕН ТОВАР") && request.body.text.includes("&lt;товар&gt;") && !request.body.text.includes("<товар>")));

    const invalidQuantityResponse = await fetch(baseUrl + "/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerName: "Тест", phone: "+7 (900) 000-00-00", deliveryType: "delivery", address: "ул. Ленина, 12", items: [{ productId: "pork-neck", quantity: 150, addons: [] }] })
    });
    assert.equal(invalidQuantityResponse.status, 400);

    const invalidModifierResponse = await fetch(baseUrl + "/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerName: "Тест", phone: "+7 (900) 000-00-00", deliveryType: "delivery", address: "ул. Ленина, 12", items: [{ productId: productCreated.body.product.id, quantity: 1, option: "Подменённый вариант", addons: [addonCreated.body.addon.id, addonCreated.body.addon.id] }] })
    });
    assert.equal(invalidModifierResponse.status, 400);

    const invalidUpload = await adminRequest("/api/admin/uploads", "POST", { dataUrl: "data:image/png;base64,bm90LWEtcG5n" });
    assert.equal(invalidUpload.response.status, 400);
    const pointCreated = await adminRequest("/api/admin/pickup-points", "POST", { name: "Тестовая точка", address: "Воронеж", hours: "09:00–22:00", isActive: true });
    assert.equal(pointCreated.response.status, 201);
    const userCreated = await adminRequest("/api/admin/users", "POST", { login: "e2e-user", password: "temporary-password", firstName: "Тест", lastName: "Сотрудник", role: "EMPLOYEE", isActive: true });
    assert.equal(userCreated.response.status, 201);
    const managerCreated = await adminRequest("/api/admin/users", "POST", { login: "e2e-manager", password: "temporary-password", firstName: "Тест", lastName: "Управляющий", role: "MANAGER", isActive: true });
    assert.equal(managerCreated.response.status, 201);

    failNextTelegramMessage = true;
    const productUpdated = await adminRequest(`/api/admin/products/${productCreated.body.product.id}`, "PUT", { price: 125, imageUrl: "/assets/cinematic-grill-v1.png", images: ["/assets/cinematic-grill-v1.png", "/assets/placeholder.svg"] });
    assert.equal(productUpdated.body.product.price, 125);
    assert.equal(productUpdated.body.product.imageUrl, "/assets/cinematic-grill-v1.png");
    const productUpdateNotifications = telegramRequests.filter((request) => request.method === "sendMessage" && request.body.text.includes("ИЗМЕНЁН ТОВАР") && request.body.text.includes("цена:") && request.body.text.includes("главное фото:") && request.body.text.includes("фотографии:"));
    assert.ok(productUpdateNotifications.length >= 2, "temporary Telegram failure must be retried with complete product changes");

    const managerLoginResponse = await fetch(baseUrl + "/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "e2e-manager", password: "temporary-password" }) });
    const managerLogin = await managerLoginResponse.json();
    assert.equal(managerLoginResponse.status, 200);
    const managerHeaders = { "content-type": "application/json", authorization: "Bearer " + managerLogin.token };
    const managerBootstrapResponse = await fetch(baseUrl + "/api/admin/bootstrap", { headers: managerHeaders });
    const managerBootstrap = await managerBootstrapResponse.json();
    assert.equal(managerBootstrap.users.length, 1);
    assert.equal(managerBootstrap.users[0].id, managerCreated.body.user.id);
    const forbiddenPriceResponse = await fetch(baseUrl + `/api/admin/products/${productCreated.body.product.id}`, { method: "PUT", headers: managerHeaders, body: JSON.stringify({ price: 999 }) });
    assert.equal(forbiddenPriceResponse.status, 403);
    const availabilityResponse = await fetch(baseUrl + `/api/admin/products/${productCreated.body.product.id}`, { method: "PUT", headers: managerHeaders, body: JSON.stringify({ isAvailable: false }) });
    assert.equal(availabilityResponse.status, 200);
    assert.equal((await availabilityResponse.json()).product.isAvailable, false);
    assert.ok(telegramRequests.some((request) => request.method === "sendMessage" && request.body.text.includes("наличие:") && request.body.text.includes("да → нет")));
    await adminRequest(`/api/admin/products/${productCreated.body.product.id}`, "PUT", { isAvailable: true });
    const categoryBlocked = await adminRequest(`/api/admin/categories/${categoryCreated.body.category.id}`, "DELETE");
    assert.equal(categoryBlocked.response.status, 409);
    assert.equal((await adminRequest(`/api/admin/users/${userCreated.body.user.id}`, "DELETE")).response.status, 200);
    assert.equal((await adminRequest(`/api/admin/users/${managerCreated.body.user.id}`, "DELETE")).response.status, 200);
    assert.equal((await adminRequest(`/api/admin/pickup-points/${pointCreated.body.point.id}`, "DELETE")).response.status, 200);
    assert.equal((await adminRequest(`/api/admin/products/${productCreated.body.product.id}`, "DELETE")).response.status, 200);
    assert.equal((await adminRequest(`/api/admin/categories/${categoryCreated.body.category.id}`, "DELETE")).response.status, 200);
    assert.equal((await adminRequest(`/api/admin/addons/${addonCreated.body.addon.id}`, "DELETE")).response.status, 200);

    const adminResponse = await fetch(baseUrl + "/api/admin/bootstrap", { headers: { authorization: "Bearer " + login.token } });
    const admin = await adminResponse.json();
    const savedOrder = admin.orders.find((order) => order.orderNumber === created.order.orderNumber);
    assert.ok(savedOrder);

    const unconfirmedEdit = await adminRequest(`/api/admin/orders/${savedOrder.id}`, "PATCH", { ...savedOrder, items: [{ productId: "pork-neck", quantity: 200, addons: [] }], agreedWithCustomer: false, expectedUpdatedAt: savedOrder.updatedAt });
    assert.equal(unconfirmedEdit.response.status, 400);
    const confirmedEdit = await adminRequest(`/api/admin/orders/${savedOrder.id}`, "PATCH", { customerName: "Тестовый заказ", phone: "+7 (900) 000-00-00", deliveryType: "delivery", address: "ул. Ленина, 14", apartment: "2", entrance: "1", floor: "1", intercom: "2", comment: "Согласовано", items: [{ productId: "pork-neck", quantity: 200, addons: [] }], agreedWithCustomer: true, expectedUpdatedAt: savedOrder.updatedAt });
    assert.equal(confirmedEdit.response.status, 200);
    assert.equal(confirmedEdit.body.order.subtotal, 360);
    assert.equal(confirmedEdit.body.order.changeLog.length, 1);

    const activeArchive = await adminRequest(`/api/admin/orders/${savedOrder.id}`, "DELETE");
    assert.equal(activeArchive.response.status, 409);

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
    assert.ok(telegramRequests.some((request) => request.method === "editMessageText" && request.body.text.includes("Статус: Заказ выполнен")));

    const cancelledOrderResponse = await fetch(baseUrl + "/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerName: "Отмена", phone: "+7 (900) 000-00-01", deliveryType: "delivery", address: "ул. Ленина, 16", items: [{ productId: "pork-neck", quantity: 100, addons: [] }] })
    });
    const cancelledOrder = await cancelledOrderResponse.json();
    assert.equal(cancelledOrderResponse.status, 201);
    const adminAfterCancellationOrder = await adminRequest("/api/admin/bootstrap", "GET");
    const savedCancelledOrder = adminAfterCancellationOrder.body.orders.find((order) => order.orderNumber === cancelledOrder.order.orderNumber);
    assert.ok(savedCancelledOrder);
    const cancelResponse = await fetch(baseUrl + "/api/admin/orders/" + savedCancelledOrder.id, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ status: "cancelled", expectedStatus: "new" })
    });
    assert.equal(cancelResponse.status, 200);
    assert.ok(telegramRequests.some((request) => request.method === "editMessageText" && request.body.text.includes(cancelledOrder.order.orderNumber) && request.body.text.includes("Статус: Заказ отменён")));

    const archiveResponse = await adminRequest(`/api/admin/orders/${savedOrder.id}`, "DELETE");
    assert.equal(archiveResponse.response.status, 200);
    assert.ok(archiveResponse.body.order.archivedAt);
    const restoreResponse = await adminRequest(`/api/admin/orders/${savedOrder.id}/restore`, "POST");
    assert.equal(restoreResponse.response.status, 200);
    assert.equal(restoreResponse.body.order.archivedAt, "");

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
    await new Promise((resolve) => telegramMock.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
