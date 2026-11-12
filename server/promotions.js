import crypto from "node:crypto";

export function normalizePromoCode(value) {
  return String(value || "").trim().toLocaleUpperCase("ru-RU").replace(/\s+/g, "");
}

export function sanitizePromotion(input, fallback = {}) {
  const code = normalizePromoCode(input.code ?? fallback.code);
  const type = input.type ?? fallback.type ?? "percent";
  const amount = Number(input.amount ?? fallback.amount);
  if (!/^[\p{L}\p{N}_-]{2,32}$/u.test(code)) throw new Error("Код должен содержать от 2 до 32 букв или цифр");
  if (!["percent", "fixed"].includes(type)) throw new Error("Выберите тип скидки");
  if (!Number.isFinite(amount) || amount <= 0 || (type === "percent" && amount > 100)) throw new Error("Укажите корректную скидку");
  const startsAt = String(input.startsAt ?? fallback.startsAt ?? "");
  const endsAt = String(input.endsAt ?? fallback.endsAt ?? "");
  if ((startsAt && !Number.isFinite(Date.parse(startsAt))) || (endsAt && !Number.isFinite(Date.parse(endsAt)))) throw new Error("Некорректная дата промокода");
  if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) throw new Error("Окончание должно быть позже начала");
  return { id: fallback.id || input.id || crypto.randomUUID(), code, type, amount, startsAt, endsAt, isActive: Boolean(input.isActive ?? fallback.isActive ?? true), uses: Number(fallback.uses || 0) };
}

export function applyPromotion(promotions, code, subtotal, now = Date.now()) {
  const normalized = normalizePromoCode(code);
  if (!normalized) return { promotion: null, discount: 0 };
  const promotion = (promotions || []).find((item) => item.code === normalized);
  if (!promotion) throw new Error("Промокод не найден");
  if (!promotion.isActive) throw new Error("Промокод отключён");
  if (promotion.startsAt && Date.parse(promotion.startsAt) > now) throw new Error("Промокод ещё не действует");
  if (promotion.endsAt && Date.parse(promotion.endsAt) <= now) throw new Error("Срок действия промокода истёк");
  const discount = Math.min(subtotal, promotion.type === "percent" ? Math.round(subtotal * promotion.amount / 100) : promotion.amount);
  return { promotion, discount: Math.max(0, discount) };
}
