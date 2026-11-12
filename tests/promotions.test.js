import test from "node:test";
import assert from "node:assert/strict";
import { applyPromotion, sanitizePromotion } from "../server/promotions.js";

test("percent promotion is calculated server-side and capped at subtotal", () => {
  const promo = sanitizePromotion({ code: "сайт", type: "percent", amount: 10 });
  assert.equal(applyPromotion([promo], " САЙТ ", 1250).discount, 125);
  assert.equal(applyPromotion([{ ...promo, type: "fixed", amount: 2000 }], "САЙТ", 1250).discount, 1250);
});

test("promotion period and state are enforced", () => {
  const promo = sanitizePromotion({ code: "TEST", type: "percent", amount: 10, startsAt: "2026-12-01T00:00:00+03:00" });
  assert.throws(() => applyPromotion([promo], "TEST", 500, Date.parse("2026-11-01T00:00:00+03:00")), /ещё не действует/);
  assert.throws(() => applyPromotion([{ ...promo, isActive: false }], "TEST", 500), /отключён/);
});
