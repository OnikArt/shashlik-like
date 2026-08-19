import test from "node:test";
import assert from "node:assert/strict";
import { availableOrderTransitions, isOrderTransitionAllowed, orderStatuses } from "../server/order-status.js";

test("canonical order status model contains only expected statuses", () => {
  assert.deepEqual(orderStatuses, ["new", "accepted", "preparing", "ready", "delivering", "completed", "cancelled"]);
});

test("delivery follows controlled forward transitions", () => {
  assert.deepEqual(availableOrderTransitions({ status: "new", fulfillmentType: "delivery" }), ["accepted", "cancelled"]);
  assert.equal(isOrderTransitionAllowed({ status: "accepted", fulfillmentType: "delivery" }, "preparing"), true);
  assert.equal(isOrderTransitionAllowed({ status: "preparing", fulfillmentType: "delivery" }, "accepted"), false);
  assert.equal(isOrderTransitionAllowed({ status: "ready", fulfillmentType: "delivery" }, "delivering"), true);
});

test("pickup skips courier delivery stage", () => {
  assert.deepEqual(availableOrderTransitions({ status: "ready", fulfillmentType: "pickup" }), ["completed", "cancelled"]);
  assert.equal(isOrderTransitionAllowed({ status: "ready", fulfillmentType: "pickup" }, "delivering"), false);
});

test("completed and cancelled orders are final", () => {
  assert.deepEqual(availableOrderTransitions({ status: "completed", fulfillmentType: "delivery" }), []);
  assert.deepEqual(availableOrderTransitions({ status: "cancelled", fulfillmentType: "pickup" }), []);
});
