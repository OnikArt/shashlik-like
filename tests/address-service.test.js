import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAddress, validateDeliveryAddress } from "../server/address-service.js";

test("delivery address requires a house", () => {
  assert.throws(() => validateDeliveryAddress("улица Ленина"), /номер дома/i);
});

test("delivery address is normalized into separate fields", () => {
  const result = validateDeliveryAddress("  ул. Ленина,   д. 12А ");
  assert.equal(result.city, "Воронеж");
  assert.equal(result.house.toLocaleLowerCase("ru-RU"), "12а");
  assert.match(result.formattedAddress, /^Воронеж,/);
  assert.equal(result.deliverable, true);
});

test("explicit address outside Voronezh is rejected", () => {
  assert.throws(() => validateDeliveryAddress("г. Москва, ул. Тверская, 1"), /только по Воронежу/i);
});

test("normalizer strips control characters and duplicate spaces", () => {
  assert.equal(normalizeAddress(" ул.  Ленина,\n 1 "), "ул. Ленина, 1");
});

