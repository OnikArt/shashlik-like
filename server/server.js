import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat, rename, readdir, unlink } from "node:fs/promises";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { availableOrderTransitions, legacyOrderStatuses, orderStatusLabels, orderStatuses, orderStatusTimestamp } from "./order-status.js";
import { AddressValidationError, validateDeliveryAddress } from "./address-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function loadEnvFile() {
  const envPath = path.join(rootDir, ".env");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const separator = trimmed.indexOf("=");
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const storePath = process.env.DATA_STORE_PATH ? path.resolve(rootDir, process.env.DATA_STORE_PATH) : path.join(__dirname, "data", "store.json");
const dataDir = path.dirname(storePath);
const port = Number(process.env.PORT || 4174);
const tokenSecret = process.env.ADMIN_TOKEN_SECRET || "local-shashlik-like-secret";
const adminPassword = process.env.ADMIN_PASSWORD || "admin";
const corsOriginPatterns = String(process.env.CORS_ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:4175")
  .split(",")
  .map((value) => value.trim().replace(/\/$/, ""))
  .filter(Boolean);

function isAllowedCorsOrigin(origin) {
  if (!origin) return false;
  return corsOriginPatterns.some((pattern) => {
    if (!pattern.includes("*")) return origin === pattern;
    const expression = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^./]+");
    return new RegExp(`^${expression}$`).test(origin);
  });
}

if (process.env.NODE_ENV === "production") {
  if (!process.env.ADMIN_TOKEN_SECRET || process.env.ADMIN_TOKEN_SECRET.length < 32) {
    throw new Error("ADMIN_TOKEN_SECRET must contain at least 32 characters in production");
  }
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === "admin" || process.env.ADMIN_PASSWORD.length < 12) {
    throw new Error("ADMIN_PASSWORD must be changed and contain at least 12 characters in production");
  }
}

const rolePermissions = {
  EMPLOYEE: ["orders.view", "orders.change_status", "orders.cancel", "profile.edit_self"],
  MANAGER: ["orders.view", "orders.manage", "orders.change_status", "orders.cancel", "products.view", "products.availability", "analytics.basic", "profile.edit_self"],
  CO_OWNER: ["orders.view", "orders.manage", "orders.change_status", "orders.cancel", "products.view", "products.edit", "analytics.basic", "analytics.financial", "users.view", "profile.edit_self"],
  OWNER: ["orders.view", "orders.manage", "orders.change_status", "orders.cancel", "products.view", "products.edit", "products.price_edit", "analytics.basic", "analytics.financial", "users.view", "users.create", "users.edit_any", "users.change_role", "settings.manage", "profile.edit_self"]
};
const roleLabels = {
  EMPLOYEE: "Сотрудник",
  MANAGER: "Управляющий",
  CO_OWNER: "Совладелец",
  OWNER: "Владелец"
};

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("base64url");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, passwordHash) {
  if (!passwordHash || !passwordHash.startsWith("scrypt:")) return false;
  const [, salt, stored] = passwordHash.split(":");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("base64url");
  const left = Buffer.from(hash);
  const right = Buffer.from(stored);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createOwnerUser() {
  const now = new Date().toISOString();
  return {
    id: "owner",
    login: "admin",
    passwordHash: hashPassword(adminPassword),
    firstName: "Артур",
    lastName: "Владелец",
    displayName: "Артур Владелец",
    role: "OWNER",
    position: "Владелец",
    avatarUrl: "",
    phone: "",
    workPointId: "",
    shiftType: "DAY",
    telegramUserId: "",
    telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
    telegramUsername: "",
    isActive: true,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: ""
  };
}

function userPermissions(user) {
  return rolePermissions[user?.role] || [];
}

function hasPermission(user, permission) {
  return userPermissions(user).includes(permission);
}

function serializeUser(user) {
  if (!user) return null;
  const { passwordHash, telegramUserId, telegramUsername, ...safe } = user;
  return {
    ...safe,
    telegramConnected: Boolean(user.telegramChatId),
    telegramChatId: user.telegramChatId ? "connected" : ""
  };
}

const confirmedPickupPoints = [
  {
    id: "pobedy-48a",
    name: "ШашлычОК",
    address: "Бульвар Победы, 48А",
    phone: "+7 995 669-12-42",
    hours: "Круглосуточно",
    mapUrl: "",
    comment: "на кольце «Бульвара Победы»",
    isActive: true
  },
  {
    id: "moskovskiy-114",
    name: "Шашлык Лайк",
    address: "Московский проспект, 114",
    phone: "+7 995 669-12-42",
    hours: "09:00–22:00",
    mapUrl: "",
    comment: "рядом с ТЦ «Москва»",
    isActive: true
  },
  {
    id: "9-yanvarya-300a",
    name: "Шашлык Лайк",
    address: "улица 9 Января, 300А",
    phone: "+7 995 669-12-42",
    hours: "09:00–22:00",
    mapUrl: "",
    comment: "",
    isActive: true
  },
  {
    id: "peshe-streletskaya-163v",
    name: "Шашлык Лайк",
    address: "Пеше-Стрелецкая улица, 163В",
    phone: "+7 995 669-12-42",
    hours: "09:00–22:00",
    mapUrl: "",
    comment: "",
    isActive: true
  }
];

const seedStore = {
  schemaVersion: 2,
  categories: [
    { id: "shashlik", name: "Шашлыки", minPrice: "От 120 ₽ / 100 г", sortOrder: 1 },
    { id: "shawarma", name: "Шаурма", minPrice: "От 240 ₽", sortOrder: 2 },
    { id: "doner", name: "Донер", minPrice: "От 250 ₽", sortOrder: 3 },
    { id: "lyulya", name: "Люля-кебаб", minPrice: "От 250 ₽", sortOrder: 4 },
    { id: "sauces", name: "Соусы", minPrice: "От 50 ₽", sortOrder: 5 },
    { id: "bread", name: "Хлеб", minPrice: "60 ₽", sortOrder: 6 },
    { id: "drinks", name: "Напитки", minPrice: "От 100 ₽", sortOrder: 7 }
  ],
  products: [
    {
      id: "pork-neck",
      slug: "svinaya-sheya",
      name: "Свиная шея",
      description: "Сочная свиная шея, приготовленная на углях до румяной корочки.",
      price: 180,
      unit: "100 г",
      step: 100,
      categoryId: "shashlik",
      imageUrl: "/assets/shashlik-hero-optimized.jpg",
      isActive: true,
      isAvailable: true,
      isFeatured: true,
      badge: "Лук бесплатно",
      sortOrder: 1
    },
    {
      id: "chicken-fillet",
      slug: "kurinaya-myakot",
      name: "Куриная мякоть",
      description: "Нежная куриная мякоть с ароматом настоящего угля.",
      price: 160,
      unit: "100 г",
      step: 100,
      categoryId: "shashlik",
      imageUrl: "/assets/shashlik-hero-optimized.jpg",
      isActive: true,
      isAvailable: true,
      isFeatured: true,
      badge: "Лук бесплатно",
      sortOrder: 2
    },
    {
      id: "pork-ribs",
      slug: "svinye-rebra",
      name: "Свиные рёбра",
      description: "Мясные рёбра на углях с плотной румяной корочкой.",
      price: 150,
      unit: "100 г",
      step: 100,
      categoryId: "shashlik",
      imageUrl: "/assets/shashlik-hero-optimized.jpg",
      isActive: true,
      isAvailable: true,
      isFeatured: false,
      badge: "Лук бесплатно",
      sortOrder: 3
    },
    {
      id: "pork-loin",
      slug: "svinaya-koreyka",
      name: "Свиная корейка",
      description: "Классическая свиная корейка для тех, кто любит уверенный вкус угля.",
      price: 150,
      unit: "100 г",
      step: 100,
      categoryId: "shashlik",
      imageUrl: "/assets/shashlik-hero-optimized.jpg",
      isActive: true,
      isAvailable: true,
      isFeatured: false,
      badge: "Лук бесплатно",
      sortOrder: 4
    },
    {
      id: "chicken-wings",
      slug: "kurinye-krylyshki",
      name: "Куриные крылышки",
      description: "Крылышки с жаром углей и хрустящей корочкой.",
      price: 120,
      unit: "100 г",
      step: 100,
      categoryId: "shashlik",
      imageUrl: "/assets/shashlik-hero-optimized.jpg",
      isActive: true,
      isAvailable: true,
      isFeatured: false,
      badge: "Лук бесплатно",
      sortOrder: 5
    },
    {
      id: "grill-chicken",
      slug: "kuritsa-gril",
      name: "Курица-гриль",
      description: "Целая курица-гриль с ароматом настоящего угля.",
      price: 900,
      unit: "1 кг",
      step: 1,
      categoryId: "shashlik",
      imageUrl: "/assets/shashlik-hero-optimized.jpg",
      isActive: true,
      isAvailable: true,
      isFeatured: false,
      badge: "Лук бесплатно",
      sortOrder: 6
    },
    {
      id: "chicken-shawarma",
      slug: "kurinaya-shaurma-klassicheskaya",
      name: "Куриная классическая",
      description: "Классическая куриная шаурма. Можно выбрать стандартный или сырный лаваш.",
      price: 240,
      unit: "400 г",
      step: 1,
      categoryId: "shawarma",
      imageUrl: "/assets/shawarma-optimized.jpg",
      isActive: true,
      isAvailable: true,
      isFeatured: false,
      options: ["Стандартный лаваш", "Сырный лаваш"],
      addonGroup: "wrap",
      sortOrder: 7
    },
    {
      id: "pork-shawarma",
      slug: "svinaya-shaurma-klassicheskaya",
      name: "Свиная классическая",
      description: "Свиная шаурма в лаваше с угольным мясом и соусом.",
      price: 250,
      unit: "400 г",
      step: 1,
      categoryId: "shawarma",
      imageUrl: "/assets/shawarma-optimized.jpg",
      isActive: true,
      isAvailable: true,
      isFeatured: false,
      options: ["Стандартный лаваш", "Сырный лаваш"],
      addonGroup: "wrap",
      sortOrder: 8
    },
    {
      id: "chicken-shawarma-xxl",
      slug: "kurinaya-shaurma-xxl",
      name: "Куриная шаурма XXL",
      description: "Большая куриная шаурма 600 г для плотного заказа.",
      price: 350,
      unit: "600 г",
      step: 1,
      categoryId: "shawarma",
      imageUrl: "/assets/shawarma-optimized.jpg",
      isActive: true,
      isAvailable: true,
      isFeatured: true,
      options: ["Стандартный лаваш", "Сырный лаваш"],
      addonGroup: "wrap",
      sortOrder: 9
    },
    {
      id: "pork-shawarma-xxl",
      slug: "svinaya-shaurma-xxl",
      name: "Свиная шаурма XXL",
      description: "Большая свиная шаурма 600 г с мясом на углях.",
      price: 370,
      unit: "600 г",
      step: 1,
      categoryId: "shawarma",
      imageUrl: "/assets/shawarma-optimized.jpg",
      isActive: true,
      isAvailable: true,
      isFeatured: true,
      options: ["Стандартный лаваш", "Сырный лаваш"],
      addonGroup: "wrap",
      sortOrder: 10
    },
    {
      id: "chicken-doner",
      slug: "doner-kurinyy-klassicheskiy",
      name: "Донер куриный классический",
      description: "Куриный донер 300 г с горячим мясом и свежими овощами.",
      price: 250,
      unit: "300 г",
      step: 1,
      categoryId: "doner",
      imageUrl: "/assets/shawarma-optimized.jpg",
      isActive: true,
      isAvailable: true,
      isFeatured: false,
      addonGroup: "wrap",
      sortOrder: 11
    },
    {
      id: "pork-doner",
      slug: "doner-svinoy-klassicheskiy",
      name: "Донер свиной классический",
      description: "Свиной донер 300 г с мясом на углях.",
      price: 270,
      unit: "300 г",
      step: 1,
      categoryId: "doner",
      imageUrl: "/assets/shawarma-optimized.jpg",
      isActive: true,
      isAvailable: true,
      isFeatured: false,
      addonGroup: "wrap",
      sortOrder: 12
    },
    {
      id: "chicken-lyulya",
      slug: "lyulya-kuritsa",
      name: "Люля-кебаб из курицы",
      description: "Куриный люля-кебаб 120 г. Дополнительный лук — бесплатно.",
      price: 250,
      unit: "120 г",
      step: 1,
      categoryId: "lyulya",
      imageUrl: "/assets/shashlik-hero-optimized.jpg",
      isActive: true,
      isAvailable: true,
      isFeatured: false,
      badge: "Дополнительный лук бесплатно",
      sortOrder: 13
    },
    {
      id: "beef-lyulya",
      slug: "lyulya-govyadina",
      name: "Люля-кебаб из говядины",
      description: "Говяжий люля-кебаб 120 г. Дополнительный лук — бесплатно.",
      price: 270,
      unit: "120 г",
      step: 1,
      categoryId: "lyulya",
      imageUrl: "/assets/shashlik-hero-optimized.jpg",
      isActive: true,
      isAvailable: true,
      isFeatured: true,
      badge: "Дополнительный лук бесплатно",
      sortOrder: 14
    },
    {
      id: "garlic-sauce",
      slug: "smetanno-chesnochnyy",
      name: "Сметанно-чесночный",
      description: "Сметанно-чесночный соус к мясу и шаурме.",
      price: 50,
      unit: "1 шт",
      step: 1,
      categoryId: "sauces",
      imageUrl: "/assets/sauce.svg",
      isActive: true,
      isAvailable: true,
      isFeatured: false,
      sortOrder: 15
    },
    {
      id: "tomato-sauce",
      slug: "tomatnyy",
      name: "Томатный",
      description: "Томатный соус к шашлыку.",
      price: 50,
      unit: "1 шт",
      step: 1,
      categoryId: "sauces",
      imageUrl: "/assets/sauce.svg",
      isActive: true,
      isAvailable: true,
      isFeatured: false,
      sortOrder: 16
    },
    {
      id: "flatbread",
      slug: "lepeshka",
      name: "Лепёшка",
      description: "Лепёшка 300 г к шашлыку и соусам.",
      price: 60,
      unit: "300 г",
      step: 1,
      categoryId: "bread",
      imageUrl: "/assets/bread.svg",
      isActive: true,
      isAvailable: true,
      isFeatured: false,
      sortOrder: 17
    },
    {
      id: "shippi",
      slug: "limonad-shippi",
      name: "Лимонад Shippi",
      description: "0,5 л. Вкусы: фейхоа, гранат, лайм, горные травы, тархун, вишня.",
      price: 100,
      unit: "0,5 л",
      step: 1,
      categoryId: "drinks",
      imageUrl: "/assets/drink.svg",
      isActive: true,
      isAvailable: true,
      isFeatured: false,
      options: ["Фейхоа", "Гранат", "Лайм", "Горные травы", "Тархун", "Вишня"],
      sortOrder: 18
    },
    {
      id: "soda-1l",
      slug: "pepsi-fanta-coca-cola-1l",
      name: "Pepsi / Fanta / Coca-Cola",
      description: "Газированный напиток 1 л.",
      price: 150,
      unit: "1 л",
      step: 1,
      categoryId: "drinks",
      imageUrl: "/assets/drink.svg",
      isActive: true,
      isAvailable: true,
      isFeatured: false,
      sortOrder: 19
    },
    {
      id: "pomegranate-juice",
      slug: "granatovyy-sok",
      name: "Гранатовый сок",
      description: "Гранатовый сок 1 л.",
      price: 150,
      unit: "1 л",
      step: 1,
      categoryId: "drinks",
      imageUrl: "/assets/drink.svg",
      isActive: true,
      isAvailable: true,
      isFeatured: false,
      sortOrder: 20
    },
    {
      id: "soda-03",
      slug: "pepsi-fanta-coca-cola-03",
      name: "Pepsi / Fanta / Coca-Cola",
      description: "Газированный напиток 0,3 л.",
      price: 100,
      unit: "0,3 л",
      step: 1,
      categoryId: "drinks",
      imageUrl: "/assets/drink.svg",
      isActive: true,
      isAvailable: true,
      isFeatured: false,
      sortOrder: 21
    }
  ],
  addons: [
    { id: "jalapeno", name: "Перец халапеньо", price: 50, isActive: true, group: "wrap" },
    { id: "cheese-sauce", name: "Сырный соус", price: 50, isActive: true, group: "wrap" },
    { id: "bbq", name: "BBQ соус", price: 50, isActive: true, group: "wrap" },
    { id: "processed-cheese", name: "Плавленый сыр", price: 50, isActive: true, group: "wrap" },
    { id: "bacon", name: "Бекон", price: 50, isActive: true, group: "wrap" }
  ],
  orders: [],
  orderStatusHistory: [],
  analyticsEvents: [],
  pickupPoints: confirmedPickupPoints,
  settings: {
    brand: "Шашлык Лайк",
    phone: "+7 995 669-12-42",
    telegramBrand: "@ShashlikLike",
    telegramOrders: "@iamartush1an",
    workHours: "09:00–22:00",
    deliveryPrice: 500,
    freeDeliveryFrom: 2000,
    deliveryRegions: "Правый берег Воронежа\nЦентральный район",
    yandexFoodUrl: "",
    deliveryUrl: "",
    socialUrl: ""
  },
  users: [createOwnerUser()],
  auditLog: [],
  telegramLinks: [],
  telegramUpdateOffset: 0
};

async function ensureStore() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(storePath)) {
    await writeStore(seedStore);
  }
}

async function readStore() {
  await ensureStore();
  let store;
  try {
    const raw = await readFile(storePath, "utf8");
    if (!raw.trim()) throw new Error("Store is empty");
    store = JSON.parse(raw.replace(/^\\uFEFF/, ""));
  } catch (error) {
    const snapshots = (await readdir(dataDir))
      .filter((name) => name.startsWith("store.json.") && name.endsWith(".tmp"))
      .map((name) => path.join(dataDir, name));
    const candidates = (await Promise.all(snapshots.map(async (candidate) => ({ candidate, mtime: (await stat(candidate)).mtimeMs }))))
      .sort((left, right) => right.mtime - left.mtime);
    for (const { candidate } of candidates) {
      try {
        const recovered = JSON.parse(await readFile(candidate, "utf8"));
        store = recovered;
        await writeFile(storePath, JSON.stringify(recovered, null, 2), "utf8");
        console.warn("Storage recovered from a valid temporary snapshot");
        break;
      } catch {
        // Try the next valid snapshot.
      }
    }
    if (!store) {
      console.error("Storage read failed; original data was left untouched:", error.message);
      throw new Error("Хранилище временно недоступно");
    }
  }
  let changed = false;
  if (Number(store.schemaVersion || 0) < 2) {
    if (!Array.isArray(store.pickupPoints) || !store.pickupPoints.length) {
      store.pickupPoints = confirmedPickupPoints.map((point) => ({ ...point }));
    }
    store.schemaVersion = 2;
    changed = true;
  }
  if (!Array.isArray(store.users) || !store.users.length) {
    store.users = [createOwnerUser()];
    changed = true;
  }
  if (!Array.isArray(store.auditLog)) {
    store.auditLog = [];
    changed = true;
  }
  if (!Array.isArray(store.telegramLinks)) {
    store.telegramLinks = [];
    changed = true;
  }
  if (!Array.isArray(store.orders)) {
    store.orders = [];
    changed = true;
  }
  if (!Array.isArray(store.orderStatusHistory)) {
    store.orderStatusHistory = [];
    changed = true;
  }
  if (!Array.isArray(store.analyticsEvents)) {
    store.analyticsEvents = [];
    changed = true;
  }
  for (const user of store.users) {
    if (!user.firstName) { user.firstName = user.displayName || user.login || "Сотрудник"; changed = true; }
    if (!user.lastName) { user.lastName = roleLabels[user.role] || "Команда"; changed = true; }
    if (!user.displayName) { user.displayName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.login; changed = true; }
    if (!user.position) { user.position = roleLabels[user.role] || "Сотрудник"; changed = true; }
    if (!user.workPointId) { user.workPointId = ""; changed = true; }
    if (!["DAY", "NIGHT"].includes(user.shiftType)) { user.shiftType = "DAY"; changed = true; }
    if (typeof user.isActive !== "boolean") { user.isActive = true; changed = true; }
  }
for (const product of store.products || []) {
    if (!Array.isArray(product.options)) {
      product.options = [];
      changed = true;
    }
    if (!Array.isArray(product.addonIds)) {
      product.addonIds = product.addonGroup
        ? (store.addons || []).filter((addon) => addon.group === product.addonGroup).map((addon) => addon.id)
        : [];
      changed = true;
    }
  }
  for (const point of store.pickupPoints || []) {
    if (typeof point.comment !== "string") {
      point.comment = "";
      changed = true;
    }
  }
  const usedTrackingTokens = new Set();
  for (const order of store.orders) {
    const canonicalStatus = orderStatuses.includes(order.status) ? order.status : legacyOrderStatuses[order.status] || "new";
    if (order.status !== canonicalStatus) { order.status = canonicalStatus; changed = true; }
    if (!order.trackingToken || usedTrackingTokens.has(order.trackingToken)) {
      order.trackingToken = crypto.randomBytes(32).toString("base64url");
      changed = true;
    }
    usedTrackingTokens.add(order.trackingToken);
    if (!order.fulfillmentType) { order.fulfillmentType = order.deliveryType === "pickup" ? "pickup" : "delivery"; changed = true; }
    if (!order.updatedAt) { order.updatedAt = order.createdAt || new Date().toISOString(); changed = true; }
    for (const field of Object.values(orderStatusTimestamp)) {
      if (typeof order[field] !== "string") { order[field] = ""; changed = true; }
    }
    if (!store.orderStatusHistory.some((entry) => entry.orderId === order.id)) {
      store.orderStatusHistory.push({
        id: crypto.randomUUID(),
        orderId: order.id,
        fromStatus: null,
        toStatus: order.status,
        changedAt: order.createdAt || order.updatedAt,
        changedByUserId: null,
        source: "system"
      });
      changed = true;
    }
  }
  if (changed) await writeStore(store);
  return store;
}

let storeWriteQueue = Promise.resolve();

function writeStore(store) {
  const snapshot = JSON.stringify(store, null, 2);
  const operation = storeWriteQueue.then(async () => {
    await mkdir(dataDir, { recursive: true });
    const temporaryPath = `${storePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, snapshot, "utf8");
      let lastError;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await rename(temporaryPath, storePath);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)));
        }
      }
      if (lastError) throw lastError;
      const staleSnapshots = (await readdir(dataDir)).filter((name) => name.startsWith("store.json.") && name.endsWith(".tmp"));
      await Promise.allSettled(staleSnapshots.map((name) => unlink(path.join(dataDir, name))));
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  });
  storeWriteQueue = operation.catch(() => undefined);
  return operation;
}

let storeMutationQueue = Promise.resolve();

function mutateStore(mutator) {
  const operation = storeMutationQueue.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    if (result?.changed !== false) await writeStore(store);
    return result;
  });
  storeMutationQueue = operation.catch(() => undefined);
  return operation;
}

class OrderStatusError extends Error {
  constructor(message, httpStatus = 400, code = "invalid_transition") {
    super(message);
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

function publicOrderDto(order) {
  const publicStatus = order.status === "preparing" ? "accepted" : order.status;
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    statusLabel: orderStatusLabels[order.status],
    publicStatus,
    fulfillmentType: order.fulfillmentType,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    acceptedAt: order.acceptedAt,
    preparingAt: order.preparingAt,
    readyAt: order.readyAt,
    deliveringAt: order.deliveringAt,
    completedAt: order.completedAt,
    cancelledAt: order.cancelledAt,
    items: order.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      quantityLabel: item.quantityLabel,
      option: item.option,
      addons: item.addons.map((addon) => ({ name: addon.name })),
      total: item.total
    })),
    subtotal: order.subtotal,
    deliveryPrice: order.deliveryPrice,
    total: order.total,
    pickupPointName: order.fulfillmentType === "pickup" ? order.pickupPointName : ""
  };
}

async function updateOrderStatus({ orderId, orderNumber, targetStatus, expectedStatus, actor, source }) {
  if (!orderStatuses.includes(targetStatus)) throw new OrderStatusError("Неизвестный статус заказа");
  if (!actor?.isActive) throw new OrderStatusError("Сотрудник не активен", 403, "forbidden");
  const permission = targetStatus === "cancelled" ? "orders.cancel" : "orders.change_status";
  if (!hasPermission(actor, permission)) throw new OrderStatusError("Недостаточно прав", 403, "forbidden");

  return mutateStore(async (store) => {
    const freshActor = store.users.find((user) => user.id === actor.id && user.isActive);
    if (!freshActor) throw new OrderStatusError("Сотрудник не активен", 403, "forbidden");
    if (!hasPermission(freshActor, permission)) throw new OrderStatusError("Недостаточно прав", 403, "forbidden");
    const order = store.orders.find((item) => (orderId ? item.id === orderId : item.orderNumber === orderNumber));
    if (!order) throw new OrderStatusError("Заказ не найден", 404, "not_found");
    if (order.status === targetStatus) return { order, changed: false, idempotent: true };
    if (expectedStatus && order.status !== expectedStatus) {
      throw new OrderStatusError(`Статус уже изменён: ${orderStatusLabels[order.status]}`, 409, "status_conflict");
    }
    if (!availableOrderTransitions(order).includes(targetStatus)) {
      throw new OrderStatusError(`Переход «${orderStatusLabels[order.status]}» → «${orderStatusLabels[targetStatus]}» недоступен`, 409);
    }
    const fromStatus = order.status;
    const changedAt = new Date().toISOString();
    order.status = targetStatus;
    order.updatedAt = changedAt;
    const timestampField = orderStatusTimestamp[targetStatus];
    if (timestampField) order[timestampField] = changedAt;
    store.orderStatusHistory.push({
      id: crypto.randomUUID(),
      orderId: order.id,
      fromStatus,
      toStatus: targetStatus,
      changedAt,
      changedByUserId: freshActor.id,
      source
    });
    return { order, changed: true, idempotent: false };
  });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128 * 1024) {
      const error = new Error("Запрос слишком большой");
      error.httpStatus = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function notFound(res) {
  send(res, 404, { error: "Not found" });
}

const rateBuckets = new Map();

function enforceRateLimit(req, res, scope, limit, windowMs) {
  const address = req.socket.remoteAddress || "unknown";
  const key = `${scope}:${address}`;
  const now = Date.now();
  const previous = rateBuckets.get(key);
  const bucket = !previous || previous.resetAt <= now ? { count: 0, resetAt: now + windowMs } : previous;
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count <= limit) return true;
  res.writeHead(429, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "retry-after": String(Math.ceil((bucket.resetAt - now) / 1000))
  });
  res.end(JSON.stringify({ error: "Слишком много запросов. Попробуйте немного позже." }));
  return false;
}

function logEvent(level, event, details = {}) {
  const safeDetails = Object.fromEntries(Object.entries(details).filter(([key]) => !/token|phone|address|name|secret|password/i.test(key)));
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...safeDetails });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

const analyticsEventNames = new Set([
  "page_view", "menu_view", "category_view", "product_view", "add_to_cart", "remove_from_cart",
  "cart_opened", "checkout_started", "address_selected", "checkout_error", "order_created",
  "order_tracking_opened", "order_completed"
]);

function sanitizeAttribution(value = {}) {
  const safe = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "referrer", "landing_page"]) {
    safe[key] = String(value?.[key] || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300);
  }
  return safe;
}

function sanitizeAnalyticsEvent(payload = {}) {
  const name = String(payload.name || "");
  if (!analyticsEventNames.has(name)) throw new Error("Неизвестное событие аналитики");
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  return {
    id: crypto.randomUUID(),
    name,
    sessionId: String(payload.sessionId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80),
    pathname: String(payload.pathname || "/").split("?")[0].slice(0, 160),
    data: {
      productId: String(data.productId || "").slice(0, 80),
      categoryId: String(data.categoryId || "").slice(0, 80),
      quantity: Math.max(0, Number(data.quantity || 0)),
      value: Math.max(0, Number(data.value || 0)),
      errorCode: String(data.errorCode || "").slice(0, 80)
    },
    attribution: sanitizeAttribution(payload.attribution),
    createdAt: new Date().toISOString()
  };
}

function buildAnalyticsSummary(store, includeFinancial) {
  const events = store.analyticsEvents || [];
  const sessions = new Set(events.map((event) => event.sessionId).filter(Boolean));
  const funnelNames = ["page_view", "menu_view", "add_to_cart", "checkout_started", "order_created"];
  const funnel = Object.fromEntries(funnelNames.map((name) => [name, new Set(events.filter((event) => event.name === name).map((event) => event.sessionId).filter(Boolean)).size]));
  const sources = new Map();
  for (const order of store.orders) {
    const source = order.attribution?.utm_source || (order.attribution?.referrer ? "referral" : "direct");
    const current = sources.get(source) || { source, orders: 0, revenue: 0 };
    current.orders += 1;
    if (order.status !== "cancelled") current.revenue += order.total;
    sources.set(source, current);
  }
  return {
    sessions: sessions.size,
    events: events.length,
    funnel,
    sources: [...sources.values()].sort((left, right) => right.orders - left.orders).map((item) => includeFinancial ? item : { source: item.source, orders: item.orders }),
    checkoutErrors: events.filter((event) => event.name === "checkout_error").length
  };
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", tokenSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyToken(token) {
  try {
    if (!token || !token.includes(".")) return null;
    const [body, signature] = token.split(".");
    const expected = crypto.createHmac("sha256", tokenSecret).update(body).digest("base64url");
    const left = Buffer.from(signature || "");
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function requireAdmin(req, res, store, permission = "orders.view") {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const payload = verifyToken(token);
  const user = payload ? store.users.find((item) => item.id === payload.userId && item.isActive) : null;
  if (!user) {
    send(res, 401, { error: "Unauthorized" });
    return null;
  }
  if (permission && !hasPermission(user, permission)) {
    send(res, 403, { error: "Недостаточно прав" });
    return null;
  }
  return user;
}

function isWeightedProduct(product) {
  return product.step > 1 && product.unit.includes("г");
}

function quantityUnits(product, quantity) {
  return isWeightedProduct(product) ? quantity / product.step : quantity;
}

function quantityLabel(product, quantity) {
  return isWeightedProduct(product) ? `${quantity} г` : `${quantity} шт`;
}

function lineItemTotal(product, quantity, addonsTotal = 0) {
  return Math.round((product.price + addonsTotal) * quantityUnits(product, quantity));
}

function publicStore(store) {
  return {
    categories: store.categories.sort((a, b) => a.sortOrder - b.sortOrder),
    products: store.products.filter((p) => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    addons: store.addons.filter((a) => a.isActive),
    pickupPoints: store.pickupPoints.filter((p) => p.isActive),
    settings: store.settings
  };
}

function forbid(res) {
  send(res, 403, { error: "Недостаточно прав" });
  return false;
}

function ensurePermission(user, res, permission) {
  return hasPermission(user, permission) || forbid(res);
}

function adminBootstrap(store, currentUser) {
  const permissions = userPermissions(currentUser);
  const { telegramLinks, telegramUpdateOffset, analyticsEvents, ...safeStore } = store;
  return {
    ...safeStore,
    orders: store.orders.map((order) => ({ ...order, availableTransitions: availableOrderTransitions(order) })),
    users: store.users.map(serializeUser),
    currentUser: serializeUser(currentUser),
    permissions,
    orderStatuses,
    orderStatusLabels,
    analyticsSummary: hasPermission(currentUser, "analytics.basic") ? buildAnalyticsSummary(store, hasPermission(currentUser, "analytics.financial")) : null
  };
}

function sanitizeUser(input, fallback = {}) {
  const displayName = String(input.displayName || fallback.displayName || `${input.firstName || fallback.firstName || ""} ${input.lastName || fallback.lastName || ""}`.trim() || input.login || fallback.login || "Сотрудник").trim();
  return {
    id: fallback.id || crypto.randomUUID(),
    login: String(input.login || fallback.login || "").trim(),
    passwordHash: input.password ? hashPassword(input.password) : fallback.passwordHash,
    firstName: String(input.firstName ?? fallback.firstName ?? "").trim(),
    lastName: String(input.lastName ?? fallback.lastName ?? "").trim(),
    displayName,
    role: rolePermissions[input.role] ? input.role : fallback.role || "EMPLOYEE",
    position: String(input.position ?? fallback.position ?? roleLabels[input.role] ?? "Сотрудник").trim(),
    avatarUrl: String(input.avatarUrl ?? fallback.avatarUrl ?? "").trim(),
    phone: String(input.phone ?? fallback.phone ?? "").trim(),
    workPointId: String(input.workPointId ?? fallback.workPointId ?? "").trim(),
    shiftType: ["DAY", "NIGHT"].includes(input.shiftType) ? input.shiftType : fallback.shiftType || "DAY",
    telegramUserId: String(input.telegramUserId ?? fallback.telegramUserId ?? "").trim(),
    telegramChatId: String(input.telegramChatId ?? fallback.telegramChatId ?? "").trim(),
    telegramUsername: String(input.telegramUsername ?? fallback.telegramUsername ?? "").trim(),
    isActive: Boolean(input.isActive ?? fallback.isActive ?? true),
    createdAt: fallback.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastLoginAt: fallback.lastLoginAt || ""
  };
}

function calculateOrder(store, payload) {
  const settings = store.settings;
  const productsById = new Map(store.products.map((product) => [product.id, product]));
  const addonsById = new Map(store.addons.map((addon) => [addon.id, addon]));
  const items = [];

  for (const item of payload.items || []) {
    const product = productsById.get(item.productId);
    if (!product || !product.isActive || !product.isAvailable) {
      throw new Error("Товар недоступен");
    }
    const quantity = Math.max(Number(item.quantity || 1), 1);
    const allowedAddonIds = new Set(product.addonIds || []);
    const addons = (item.addons || [])
      .filter((id) => allowedAddonIds.has(id))
      .map((id) => addonsById.get(id))
      .filter(Boolean)
      .filter((addon) => addon.isActive)
      .map((addon) => ({ id: addon.id, name: addon.name, price: addon.price }));
    const addonsTotal = addons.reduce((sum, addon) => sum + addon.price, 0);
    const lineTotal = lineItemTotal(product, quantity, addonsTotal);
    items.push({
      productId: product.id,
      name: product.name,
      unit: product.unit,
      price: product.price,
      quantity,
      quantityLabel: quantityLabel(product, quantity),
      option: item.option || "",
      addons,
      total: lineTotal
    });
  }

  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const deliveryType = payload.deliveryType === "pickup" ? "pickup" : "delivery";
  const deliveryPrice = deliveryType === "delivery" && subtotal < settings.freeDeliveryFrom ? settings.deliveryPrice : 0;
  return { items, subtotal, deliveryPrice, total: subtotal + deliveryPrice, deliveryType };
}

function makeOrderNumber(nextIndex) {
  return `SL-${String(nextIndex).padStart(6, "0")}`;
}

function telegramMessage(order) {
  const lines = [
    "🔥 Заказ #" + order.orderNumber,
    "Статус: " + orderStatusLabels[order.status],
    "",
    "Клиент: " + order.customerName,
    "Телефон: " + order.phone,
    "Получение: " + (order.deliveryType === "pickup" ? "Самовывоз" : "Доставка"),
    "Адрес: " + (order.deliveryType === "pickup" ? order.pickupPointName || "Точка будет уточнена" : order.address || "Не указан"),
    "",
    "ЗАКАЗ:"
  ];
  order.items.forEach((item, index) => {
    const addons = item.addons.length ? " + " + item.addons.map((addon) => addon.name).join(", ") : "";
    const option = item.option ? " (" + item.option + ")" : "";
    lines.push((index + 1) + ". " + item.name + option + addons);
    lines.push((item.quantityLabel || item.quantity + " × " + item.unit) + " — " + item.total + " ₽");
  });
  lines.push("", "────────────────", "Товары: " + order.subtotal + " ₽", "Доставка: " + order.deliveryPrice + " ₽", "ИТОГО: " + order.total + " ₽");
  if (order.comment) lines.push("", "Комментарий: " + order.comment);
  return lines.join("\n");
}

function telegramOrderKeyboard(order) {
  const labels = {
    accepted: "✅ Принять заказ",
    preparing: "🔥 Начать готовить",
    ready: "✅ Заказ готов",
    delivering: "🚗 Передан курьеру",
    completed: order.fulfillmentType === "pickup" ? "✅ Заказ выдан" : "✅ Заказ доставлен",
    cancelled: "❌ Отменить"
  };
  const buttons = availableOrderTransitions(order).map((status) => ({
    text: labels[status],
    callback_data: `os:${order.orderNumber}:${status}:${order.status}`
  }));
  const primary = buttons.filter((button) => !button.callback_data.includes(":cancelled:"));
  const cancel = buttons.filter((button) => button.callback_data.includes(":cancelled:"));
  return { inline_keyboard: [...primary.map((button) => [button]), ...(cancel.length ? [cancel] : [])] };
}

async function telegramRequest(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.description || "Telegram HTTP " + response.status);
  return payload.result;
}

async function sendTelegramText(chatIds, text) {
  const uniqueChatIds = [...new Set(chatIds.map(String).filter(Boolean))];
  if (!uniqueChatIds.length) return { sent: false, reason: "no_recipients" };
  const settled = await Promise.allSettled(uniqueChatIds.map((chatId) => telegramRequest("sendMessage", { chat_id: chatId, text })));
  const sent = settled.filter((result) => result.status === "fulfilled").length;
  const firstError = settled.find((result) => result.status === "rejected");
  return {
    sent: sent > 0,
    sentCount: sent,
    recipientCount: uniqueChatIds.length,
    reason: firstError?.reason?.message || ""
  };
}

function connectedChats(store, filter = () => true) {
  return store.users.filter((user) => user.isActive && user.telegramChatId && filter(user)).map((user) => user.telegramChatId);
}

async function sendOrderTelegram(store, order) {
  if (process.env.TELEGRAM_DISABLED === "true") return { sent: false, reason: "disabled", messages: [] };
  const recipients = connectedChats(store);
  if (!recipients.length && process.env.TELEGRAM_CHAT_ID) recipients.push(process.env.TELEGRAM_CHAT_ID);
  const uniqueRecipients = [...new Set(recipients.map(String).filter(Boolean))];
  const settled = await Promise.allSettled(uniqueRecipients.map((chatId) => telegramRequest("sendMessage", {
    chat_id: chatId,
    text: telegramMessage(order),
    reply_markup: telegramOrderKeyboard(order)
  })));
  const messages = settled.flatMap((result, index) => result.status === "fulfilled"
    ? [{ chatId: uniqueRecipients[index], messageId: result.value.message_id }]
    : []);
  const firstError = settled.find((result) => result.status === "rejected");
  return {
    sent: messages.length > 0,
    sentCount: messages.length,
    recipientCount: uniqueRecipients.length,
    messages,
    reason: firstError?.reason?.message || ""
  };
}

async function refreshOrderTelegram(order) {
  const messages = order.telegram?.messages || [];
  await Promise.allSettled(messages.map((message) => telegramRequest("editMessageText", {
    chat_id: message.chatId,
    message_id: message.messageId,
    text: telegramMessage(order),
    reply_markup: telegramOrderKeyboard(order)
  })));
}

function changeLabel(key) {
  return ({
    name: "название",
    description: "описание",
    price: "цена",
    unit: "единица",
    categoryId: "категория",
    isActive: "активность",
    isAvailable: "наличие",
    isFeatured: "метка «Хит»",
    options: "варианты выбора",
    addonIds: "дополнения",
    role: "роль",
    position: "должность",
    phone: "телефон",
    workPointId: "точка",
    shiftType: "смена",
    firstName: "имя",
    lastName: "фамилия"
  })[key] || key;
}

function formatChangedValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "нет";
  if (typeof value === "boolean") return value ? "да" : "нет";
  return String(value ?? "пусто");
}

function describeChanges(before, after, keys) {
  return keys.flatMap((key) => {
    const previous = JSON.stringify(before?.[key] ?? null);
    const next = JSON.stringify(after?.[key] ?? null);
    return previous === next ? [] : [changeLabel(key) + ": " + formatChangedValue(before?.[key]) + " → " + formatChangedValue(after?.[key])];
  });
}

function auditActor(user) {
  return userNameForAudit(user) + " · " + roleLabels[user.role] + " · " + (user.position || roleLabels[user.role]);
}

function userNameForAudit(user) {
  return (String(user.firstName || "") + " " + String(user.lastName || "")).trim() || user.login || "Сотрудник";
}

async function notifyAudit(store, actor, scope, action, subject, changes = []) {
  const entry = {
    id: crypto.randomUUID(),
    actorId: actor.id,
    actor: auditActor(actor),
    scope,
    action,
    subject,
    changes,
    createdAt: new Date().toISOString()
  };
  store.auditLog.unshift(entry);
  store.auditLog = store.auditLog.slice(0, 500);
  const managementOnly = scope === "users";
  const recipients = connectedChats(store, (user) => !managementOnly || ["MANAGER", "CO_OWNER", "OWNER"].includes(user.role));
  const text = [
    "Шашлык Лайк · изменение",
    "Кто: " + entry.actor,
    "Действие: " + action,
    "Объект: " + subject,
    ...(changes.length ? ["Изменения:", ...changes.map((change) => "• " + change)] : [])
  ].join("\n");
  try {
    await sendTelegramText(recipients, text);
  } catch (error) {
    console.error("Telegram audit delivery failed:", error.message);
  }
}

function applyTelegramLink(store, user, rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) return null;
  const linkIndex = store.telegramLinks.findIndex((link) => link.code === code && link.expiresAt > Date.now());
  if (linkIndex === -1) throw new Error("Код Telegram не найден или истёк");
  const link = store.telegramLinks[linkIndex];
  const collision = store.users.find((item) => item.id !== user.id && (item.telegramChatId === link.chatId || item.telegramUserId === link.telegramUserId));
  if (collision) throw new Error("Этот Telegram уже подключён к другому сотруднику");
  user.telegramChatId = link.chatId;
  user.telegramUserId = link.telegramUserId;
  user.telegramUsername = link.telegramUsername;
  store.telegramLinks.splice(linkIndex, 1);
  return link;
}

async function welcomeTelegramUser(user) {
  if (!user.telegramChatId) return;
  const text = [
    "Добро пожаловать в команду «Шашлык Лайк»!",
    "Профиль: " + userNameForAudit(user),
    "Роль: " + roleLabels[user.role],
    "Должность: " + (user.position || roleLabels[user.role]),
    "",
    "Подключение завершено. Теперь сюда будут приходить доступные для вашей роли уведомления."
  ].join("\n");
  try {
    await sendTelegramText([user.telegramChatId], text);
  } catch (error) {
    console.error("Telegram welcome failed:", error.message);
  }
}

function createTelegramLink(store, message) {
  const chatId = String(message.chat.id);
  const telegramUserId = String(message.from?.id || message.chat.id);
  const existing = store.users.find((user) => user.telegramChatId === chatId || user.telegramUserId === telegramUserId);
  if (existing) {
    if (!existing.telegramUserId) existing.telegramUserId = telegramUserId;
    if (!existing.telegramUsername) existing.telegramUsername = String(message.from?.username || "");
    return { existing };
  }
  const code = crypto.randomBytes(4).toString("hex").toUpperCase();
  store.telegramLinks = store.telegramLinks.filter((link) => link.expiresAt > Date.now() && link.chatId !== chatId);
  store.telegramLinks.push({
    code,
    chatId,
    telegramUserId,
    telegramUsername: String(message.from?.username || ""),
    firstName: String(message.from?.first_name || ""),
    expiresAt: Date.now() + 30 * 60 * 1000
  });
  return { code };
}

async function handleTelegramMessage(message) {
  const result = await mutateStore(async (store) => ({ ...createTelegramLink(store, message), changed: true }));
  if (result.existing) {
    await sendTelegramText([message.chat.id], "Вы уже подключены как " + userNameForAudit(result.existing) + " (" + roleLabels[result.existing.role] + ").");
  } else {
    await sendTelegramText([message.chat.id], "Код подключения: " + result.code + "\nПередайте его владельцу. Код действует 30 минут и используется один раз.");
  }
}

async function handleTelegramCallback(callback) {
  const callbackId = callback.id;
  const match = String(callback.data || "").match(/^os:(SL-\d+):(new|accepted|preparing|ready|delivering|completed|cancelled):(new|accepted|preparing|ready|delivering|completed|cancelled)$/);
  if (!match) {
    await telegramRequest("answerCallbackQuery", { callback_query_id: callbackId, text: "Неизвестное действие", show_alert: true });
    return;
  }
  const store = await readStore();
  const telegramUserId = String(callback.from?.id || "");
  const actor = store.users.find((user) => user.isActive && user.telegramUserId === telegramUserId);
  if (!actor) {
    await telegramRequest("answerCallbackQuery", { callback_query_id: callbackId, text: "Telegram не привязан к активному сотруднику", show_alert: true });
    return;
  }
  try {
    const result = await updateOrderStatus({
      orderNumber: match[1],
      targetStatus: match[2],
      expectedStatus: match[3],
      actor,
      source: "telegram"
    });
    await refreshOrderTelegram(result.order);
    await telegramRequest("answerCallbackQuery", {
      callback_query_id: callbackId,
      text: result.idempotent ? "Статус уже актуален" : orderStatusLabels[result.order.status]
    });
  } catch (error) {
    await telegramRequest("answerCallbackQuery", {
      callback_query_id: callbackId,
      text: error.message || "Не удалось изменить статус",
      show_alert: true
    });
  }
}

let telegramPollInProgress = false;

async function pollTelegram() {
  if (!process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_DISABLED === "true") return;
  if (telegramPollInProgress) return;
  telegramPollInProgress = true;
  try {
    const store = await readStore();
    const updates = await telegramRequest("getUpdates", {
      offset: Number(store.telegramUpdateOffset || 0),
      timeout: 0,
      allowed_updates: ["message", "callback_query"]
    });
    for (const update of updates) {
      if (update.callback_query) await handleTelegramCallback(update.callback_query);
      else if (update.message?.chat?.id) await handleTelegramMessage(update.message);
    }
    if (updates.length) {
      const nextOffset = Math.max(...updates.map((update) => update.update_id + 1));
      await mutateStore(async (freshStore) => {
        freshStore.telegramUpdateOffset = Math.max(Number(freshStore.telegramUpdateOffset || 0), nextOffset);
        return { changed: true };
      });
    }
  } catch (error) {
    console.error("Telegram polling failed:", error.message);
  } finally {
    telegramPollInProgress = false;
  }
}

function sanitizeProduct(input, fallback = {}) {
  return {
    id: input.id || fallback.id || crypto.randomUUID(),
    slug: input.slug || fallback.slug || String(input.name || "product").toLowerCase().replace(/\s+/g, "-"),
    name: String(input.name || fallback.name || "").trim(),
    description: String(input.description || fallback.description || "").trim(),
    price: Number(input.price ?? fallback.price ?? 0),
    unit: String(input.unit || fallback.unit || "1 шт").trim(),
    step: Number(input.step ?? fallback.step ?? 1),
    categoryId: String(input.categoryId || fallback.categoryId || "shashlik"),
    imageUrl: String(input.imageUrl || fallback.imageUrl || "/assets/placeholder.svg"),
    isActive: Boolean(input.isActive ?? fallback.isActive ?? true),
    isAvailable: Boolean(input.isAvailable ?? fallback.isAvailable ?? true),
    isFeatured: Boolean(input.isFeatured ?? fallback.isFeatured ?? false),
    badge: String(input.badge || fallback.badge || ""),
    options: Array.isArray(input.options) ? input.options : fallback.options || [],
    addonGroup: input.addonGroup || fallback.addonGroup || "",
    addonIds: Array.isArray(input.addonIds) ? input.addonIds.map(String) : fallback.addonIds || [],
    sortOrder: Number(input.sortOrder ?? fallback.sortOrder ?? 999)
  };
}

async function api(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return send(res, 200, {
      status: "ok",
      service: "shashlik-like",
      uptime: Math.round(process.uptime())
    });
  }

  const store = await readStore();

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    return send(res, 200, publicStore(store));
  }

  if (req.method === "POST" && url.pathname === "/api/analytics") {
    if (!enforceRateLimit(req, res, "analytics", 180, 60_000)) return;
    try {
      const event = sanitizeAnalyticsEvent(await readJson(req));
      await mutateStore(async (freshStore) => {
        freshStore.analyticsEvents.push(event);
        if (freshStore.analyticsEvents.length > 10_000) freshStore.analyticsEvents.splice(0, freshStore.analyticsEvents.length - 10_000);
        return { event };
      });
      return send(res, 202, { accepted: true });
    } catch (error) {
      return send(res, error.httpStatus || 400, { error: error.message || "Событие отклонено" });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/address/validate") {
    if (!enforceRateLimit(req, res, "address", 60, 60_000)) return;
    try {
      const payload = await readJson(req);
      return send(res, 200, { address: validateDeliveryAddress(payload.address) });
    } catch (error) {
      logEvent("warn", "address.validation_failed", { code: error.code || "invalid_address" });
      return send(res, error.httpStatus || 400, { error: error.message || "Не удалось проверить адрес", code: error.code });
    }
  }

  const trackingMatch = url.pathname.match(/^\/api\/orders\/track\/([A-Za-z0-9_-]{40,})$/);
  if (req.method === "GET" && trackingMatch) {
    if (!enforceRateLimit(req, res, "tracking", 120, 60_000)) return;
    const order = store.orders.find((item) => item.trackingToken === trackingMatch[1]);
    if (!order) return send(res, 404, { error: "Заказ не найден" });
    return send(res, 200, { order: publicOrderDto(order) });
  }

  if (req.method === "POST" && url.pathname === "/api/orders") {
    if (!enforceRateLimit(req, res, "checkout", 12, 10 * 60_000)) return;
    try {
      const payload = await readJson(req);
      const created = await mutateStore(async (freshStore) => {
        const calculated = calculateOrder(freshStore, payload);
        if (!calculated.items.length) throw new Error("Корзина пуста");
        const customerName = String(payload.customerName || "").trim().slice(0, 80);
        const phone = String(payload.phone || "").trim();
        if (!customerName || phone.replace(/\D/g, "").length !== 11) throw new Error("Укажите имя и корректный российский номер телефона");

        const addressData = calculated.deliveryType === "delivery" ? validateDeliveryAddress(payload.address) : null;
        const pickupPoint = calculated.deliveryType === "pickup"
          ? freshStore.pickupPoints.find((point) => point.id === String(payload.pickupPointId || "") && point.isActive)
          : null;
        if (calculated.deliveryType === "pickup" && !pickupPoint) throw new Error("Выберите доступную точку самовывоза");

        const createdAt = new Date().toISOString();
        const order = {
          id: crypto.randomUUID(),
          orderNumber: makeOrderNumber(freshStore.orders.length + 1),
          trackingToken: crypto.randomBytes(32).toString("base64url"),
          customerName,
          phone,
          deliveryType: calculated.deliveryType,
          fulfillmentType: calculated.deliveryType,
          address: addressData?.formattedAddress || "",
          addressData,
          apartment: String(payload.apartment || "").trim().slice(0, 20),
          entrance: String(payload.entrance || "").trim().slice(0, 20),
          floor: String(payload.floor || "").trim().slice(0, 20),
          intercom: String(payload.intercom || "").trim().slice(0, 40),
          pickupPointId: pickupPoint?.id || "",
          pickupPointName: pickupPoint?.name || "",
          comment: String(payload.comment || "").trim().slice(0, 500),
          attribution: sanitizeAttribution(payload.attribution),
          items: calculated.items,
          subtotal: calculated.subtotal,
          deliveryPrice: calculated.deliveryPrice,
          total: calculated.total,
          paymentMethod: "PAY_ON_DELIVERY",
          status: "new",
          telegram: { sent: false, reason: "pending" },
          createdAt,
          updatedAt: createdAt,
          acceptedAt: "",
          preparingAt: "",
          readyAt: "",
          deliveringAt: "",
          completedAt: "",
          cancelledAt: ""
        };
        freshStore.orders.unshift(order);
        freshStore.orderStatusHistory.push({
          id: crypto.randomUUID(),
          orderId: order.id,
          fromStatus: null,
          toStatus: "new",
          changedAt: order.createdAt,
          changedByUserId: null,
          source: "system"
        });
        freshStore.analyticsEvents.push({
          id: crypto.randomUUID(),
          name: "order_created",
          sessionId: String(payload.analyticsSessionId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80),
          pathname: "/checkout",
          data: { productId: "", categoryId: "", quantity: 0, value: order.total, errorCode: "" },
          attribution: order.attribution,
          createdAt: order.createdAt
        });
        return { order, notificationStore: freshStore };
      });

      try {
        const telegram = await sendOrderTelegram(created.notificationStore, created.order);
        await mutateStore(async (freshStore) => {
          const savedOrder = freshStore.orders.find((item) => item.id === created.order.id);
          if (savedOrder) savedOrder.telegram = telegram;
          return { changed: Boolean(savedOrder) };
        });
        created.order.telegram = telegram;
      } catch (error) {
        logEvent("error", "telegram.order_notification_failed", { orderId: created.order.id, reason: error.message });
      }
      const order = created.order;
      logEvent("info", "checkout.order_created", { orderId: order.id, total: order.total, fulfillmentType: order.fulfillmentType });
      return send(res, 201, { order: { orderNumber: order.orderNumber, trackingToken: order.trackingToken, status: order.status } });
    } catch (error) {
      logEvent("warn", "checkout.rejected", { code: error.code || "invalid_order" });
      return send(res, error.httpStatus || 400, { error: error.message || "Не удалось оформить заказ", code: error.code });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    if (!enforceRateLimit(req, res, "admin-login", 10, 15 * 60_000)) return;
    const payload = await readJson(req);
    const login = String(payload.login || "admin").trim();
    const user = store.users.find((item) => item.login === login && item.isActive);
    if (!user || !verifyPassword(payload.password, user.passwordHash)) {
      return send(res, 401, { error: "Неверный логин или пароль" });
    }
    user.lastLoginAt = new Date().toISOString();
    await writeStore(store);
    return send(res, 200, {
      token: signToken({ userId: user.id, role: user.role, exp: Date.now() + 1000 * 60 * 60 * 12 }),
      user: serializeUser(user),
      permissions: userPermissions(user)
    });
  }

  let adminUser = null;
  if (url.pathname.startsWith("/api/admin")) {
    adminUser = requireAdmin(req, res, store);
    if (!adminUser) return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/bootstrap") {
    return send(res, 200, adminBootstrap(store, adminUser));
  }

  if (req.method === "POST" && url.pathname === "/api/admin/users") {
    if (!ensurePermission(adminUser, res, "users.create")) return;
    const payload = await readJson(req);
    if (!payload.login || !payload.password) return send(res, 400, { error: "Нужны login и password" });
    if (!String(payload.firstName || "").trim() || !String(payload.lastName || "").trim()) return send(res, 400, { error: "Имя и фамилия обязательны" });
    if (store.users.some((user) => user.login === payload.login)) return send(res, 409, { error: "Такой login уже существует" });
    const user = sanitizeUser(payload);
    try {
      applyTelegramLink(store, user, payload.telegramLinkCode);
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
    store.users.push(user);
    await notifyAudit(store, adminUser, "users", "Добавлен сотрудник", userNameForAudit(user), [
      "роль: " + roleLabels[user.role],
      "должность: " + user.position
    ]);
    await writeStore(store);
    if (user.telegramChatId) await welcomeTelegramUser(user);
    return send(res, 201, { user: serializeUser(user) });
  }

  const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userMatch && req.method === "PUT") {
    const userId = decodeURIComponent(userMatch[1]);
    if (userId !== adminUser.id && !ensurePermission(adminUser, res, "users.edit_any")) return;
    const userIndex = store.users.findIndex((user) => user.id === userId);
    if (userIndex === -1) return notFound(res);
    const payload = await readJson(req);
    const before = { ...store.users[userIndex] };
    if (payload.role && payload.role !== before.role && !hasPermission(adminUser, "users.change_role")) return forbid(res);
    const nextFirstName = String(payload.firstName ?? before.firstName ?? "").trim();
    const nextLastName = String(payload.lastName ?? before.lastName ?? "").trim();
    if (!nextFirstName || !nextLastName) return send(res, 400, { error: "Имя и фамилия обязательны" });
    const activeOwners = store.users.filter((user) => user.role === "OWNER" && user.isActive);
    if (before.role === "OWNER" && before.isActive && activeOwners.length === 1) {
      if (payload.role && payload.role !== "OWNER") return send(res, 400, { error: "Нельзя понизить единственного активного владельца" });
      if (payload.isActive === false) return send(res, 400, { error: "Нельзя отключить единственного активного владельца" });
    }
    const next = sanitizeUser(payload, before);
    let linked = false;
    try {
      linked = Boolean(applyTelegramLink(store, next, payload.telegramLinkCode));
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
    store.users[userIndex] = next;
    const changes = describeChanges(before, next, ["firstName", "lastName", "role", "position", "phone", "workPointId", "shiftType", "isActive"]);
    if (linked) changes.push("Telegram: подключён");
    await notifyAudit(store, adminUser, "users", "Изменён сотрудник", userNameForAudit(next), changes);
    await writeStore(store);
    if (linked) await welcomeTelegramUser(next);
    return send(res, 200, { user: serializeUser(next) });
  }

const deleteUserMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (deleteUserMatch && req.method === "DELETE") {
    if (!ensurePermission(adminUser, res, "users.edit_any")) return;
    const userId = decodeURIComponent(deleteUserMatch[1]);
    const userIndex = store.users.findIndex((user) => user.id === userId);
    if (userIndex === -1) return notFound(res);
    const target = store.users[userIndex];
    if (target.id === adminUser.id) return send(res, 400, { error: "Нельзя удалить собственный активный профиль" });
    if (target.role === "OWNER") return send(res, 400, { error: "Владельца нельзя удалить" });
    store.users.splice(userIndex, 1);
    await notifyAudit(store, adminUser, "users", "Удалён сотрудник", userNameForAudit(target), [
      "роль: " + roleLabels[target.role],
      "должность: " + target.position
    ]);
    await writeStore(store);
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/products") {
    if (!ensurePermission(adminUser, res, "products.edit")) return;
    const payload = await readJson(req);
    const product = sanitizeProduct(payload);
    store.products.push(product);
    await notifyAudit(store, adminUser, "products", "Добавлен товар", product.name, [
      "цена: " + product.price + " ₽",
      "варианты: " + formatChangedValue(product.options),
      "дополнения: " + formatChangedValue(product.addonIds)
    ]);
    await writeStore(store);
    return send(res, 201, { product });
  }

  const productMatch = url.pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (productMatch) {
    const productId = decodeURIComponent(productMatch[1]);
    const productIndex = store.products.findIndex((product) => product.id === productId);
    if (productIndex === -1) return notFound(res);
    if (req.method === "PUT") {
      if (!ensurePermission(adminUser, res, "products.edit")) return;
      const payload = await readJson(req);
      const before = { ...store.products[productIndex] };
      const next = sanitizeProduct({ ...before, ...payload }, before);
      store.products[productIndex] = next;
      const changes = describeChanges(before, next, ["name", "description", "price", "unit", "categoryId", "isActive", "isAvailable", "isFeatured", "options", "addonIds"]);
      await notifyAudit(store, adminUser, "products", "Изменён товар", next.name, changes);
      await writeStore(store);
      return send(res, 200, { product: next });
    }
    if (req.method === "DELETE") {
      if (!ensurePermission(adminUser, res, "products.edit")) return;
      const removed = store.products.splice(productIndex, 1)[0];
      await notifyAudit(store, adminUser, "products", "Удалён товар", removed.name);
      await writeStore(store);
      return send(res, 200, { ok: true });
    }
  }

if (req.method === "POST" && url.pathname === "/api/admin/addons") {
    if (!ensurePermission(adminUser, res, "products.edit")) return;
    const payload = await readJson(req);
    const addon = {
      id: crypto.randomUUID(),
      name: String(payload.name || "").trim(),
      price: Math.max(0, Number(payload.price || 0)),
      group: String(payload.group || "custom").trim(),
      isActive: Boolean(payload.isActive ?? true)
    };
    if (!addon.name) return send(res, 400, { error: "Укажите название дополнения" });
    store.addons.push(addon);
    await notifyAudit(store, adminUser, "products", "Добавлено дополнение", addon.name, ["цена: " + addon.price + " ₽"]);
    await writeStore(store);
    return send(res, 201, { addon });
  }

  const addonMatch = url.pathname.match(/^\/api\/admin\/addons\/([^/]+)$/);
  if (addonMatch) {
    const addonId = decodeURIComponent(addonMatch[1]);
    const addonIndex = store.addons.findIndex((addon) => addon.id === addonId);
    if (addonIndex === -1) return notFound(res);
    if (req.method === "PUT") {
      if (!ensurePermission(adminUser, res, "products.edit")) return;
      const payload = await readJson(req);
      const before = { ...store.addons[addonIndex] };
      const next = {
        ...before,
        name: String(payload.name ?? before.name).trim(),
        price: Math.max(0, Number(payload.price ?? before.price)),
        group: String(payload.group ?? before.group).trim(),
        isActive: Boolean(payload.isActive ?? before.isActive)
      };
      store.addons[addonIndex] = next;
      await notifyAudit(store, adminUser, "products", "Изменено дополнение", next.name, describeChanges(before, next, ["name", "price", "isActive"]));
      await writeStore(store);
      return send(res, 200, { addon: next });
    }
    if (req.method === "DELETE") {
      if (!ensurePermission(adminUser, res, "products.edit")) return;
      const removed = store.addons.splice(addonIndex, 1)[0];
      store.products = store.products.map((product) => ({ ...product, addonIds: (product.addonIds || []).filter((id) => id !== removed.id) }));
      await notifyAudit(store, adminUser, "products", "Удалено дополнение", removed.name);
      await writeStore(store);
      return send(res, 200, { ok: true });
    }
  }

  const orderMatch = url.pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
  if (orderMatch && req.method === "PUT") {
    const orderId = decodeURIComponent(orderMatch[1]);
    const payload = await readJson(req);
    try {
      const result = await updateOrderStatus({
        orderId,
        targetStatus: String(payload.status || ""),
        expectedStatus: String(payload.expectedStatus || ""),
        actor: adminUser,
        source: "admin"
      });
      await refreshOrderTelegram(result.order);
      return send(res, 200, { order: result.order, idempotent: result.idempotent });
    } catch (error) {
      return send(res, error.httpStatus || 400, { error: error.message || "Не удалось изменить статус", code: error.code });
    }
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/settings") {
    if (!ensurePermission(adminUser, res, "settings.manage")) return;
    const payload = await readJson(req);
    store.settings = {
      ...store.settings,
      ...payload,
      deliveryPrice: Number(payload.deliveryPrice ?? store.settings.deliveryPrice),
      freeDeliveryFrom: Number(payload.freeDeliveryFrom ?? store.settings.freeDeliveryFrom)
    };
    await writeStore(store);
    return send(res, 200, { settings: store.settings });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/pickup-points") {
    if (!ensurePermission(adminUser, res, "settings.manage")) return;
    const payload = await readJson(req);
    const point = {
      id: crypto.randomUUID(),
      name: String(payload.name || "Новая точка"),
      address: String(payload.address || ""),
      phone: String(payload.phone || ""),
      hours: String(payload.hours || store.settings.workHours),
      mapUrl: String(payload.mapUrl || ""),
      comment: String(payload.comment || ""),
      isActive: Boolean(payload.isActive ?? true)
    };
    store.pickupPoints.push(point);
    await writeStore(store);
    return send(res, 201, { point });
  }

  const pointMatch = url.pathname.match(/^\/api\/admin\/pickup-points\/([^/]+)$/);
  if (pointMatch) {
    const pointId = decodeURIComponent(pointMatch[1]);
    const pointIndex = store.pickupPoints.findIndex((point) => point.id === pointId);
    if (pointIndex === -1) return notFound(res);
    if (req.method === "PUT") {
      if (!ensurePermission(adminUser, res, "settings.manage")) return;
      const payload = await readJson(req);
      store.pickupPoints[pointIndex] = { ...store.pickupPoints[pointIndex], ...payload };
      await writeStore(store);
      return send(res, 200, { point: store.pickupPoints[pointIndex] });
    }
    if (req.method === "DELETE") {
      if (!ensurePermission(adminUser, res, "settings.manage")) return;
      store.pickupPoints.splice(pointIndex, 1);
      await writeStore(store);
      return send(res, 200, { ok: true });
    }
  }

  return notFound(res);
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

async function staticFile(req, res, url) {
  const distDir = path.join(rootDir, "dist");
  const publicDir = path.join(rootDir, "public");
  const requested = decodeURIComponent(url.pathname);
  if (requested === "/sitemap.xml") {
    const origin = String(process.env.PUBLIC_SITE_URL || `http://${req.headers.host || `localhost:${port}`}`).replace(/\/$/, "");
    const pages = ["/", "/menu", "/delivery", "/pickup", "/about", "/contacts"];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((page) => `  <url><loc>${origin}${page}</loc></url>`).join("\n")}\n</urlset>`;
    res.writeHead(200, { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" });
    res.end(xml);
    return;
  }
  const candidates = [
    path.join(distDir, requested === "/" ? "index.html" : requested),
    path.join(publicDir, requested)
  ];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(distDir) && !resolved.startsWith(publicDir)) continue;
    try {
      const info = await stat(resolved);
      if (!info.isFile()) continue;
      res.writeHead(200, { "content-type": mimeTypes[path.extname(resolved)] || "application/octet-stream" });
      createReadStream(resolved).pipe(res);
      return;
    } catch {
      // Continue to next candidate.
    }
  }
  const spa = path.join(distDir, "index.html");
  if (existsSync(spa)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    createReadStream(spa).pipe(res);
    return;
  }
  send(res, 404, { error: "Build not found. Run npm.cmd run build or use npm.cmd run dev." });
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const requestOrigin = String(req.headers.origin || "").replace(/\/$/, "");
    if (url.pathname.startsWith("/api/") && requestOrigin && isAllowedCorsOrigin(requestOrigin)) {
      res.setHeader("access-control-allow-origin", requestOrigin);
      res.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("access-control-allow-headers", "authorization, content-type");
      res.setHeader("access-control-max-age", "86400");
      res.setHeader("vary", "Origin");
    }
    if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      if (!requestOrigin || !isAllowedCorsOrigin(requestOrigin)) {
        send(res, 403, { error: "Origin is not allowed" });
        return;
      }
      res.writeHead(204);
      res.end();
      return;
    }
    const canonicalOrigin = String(process.env.PUBLIC_SITE_URL || "").replace(/\/$/, "");
    if (process.env.NODE_ENV === "production" && canonicalOrigin) {
      const canonical = new URL(canonicalOrigin);
      const incomingHost = String(req.headers.host || "").split(":")[0].toLowerCase();
      const alternateHost = canonical.hostname.startsWith("www.") ? canonical.hostname.slice(4) : `www.${canonical.hostname}`;
      if (incomingHost === alternateHost) {
        res.writeHead(308, { location: `${canonical.origin}${url.pathname}${url.search}` });
        res.end();
        return;
      }
    }
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
    res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("cross-origin-opener-policy", "same-origin");
    if (process.env.NODE_ENV === "production" && req.headers["x-forwarded-proto"] === "https") {
      res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
    }
    if (url.pathname.startsWith("/admin") || url.pathname.startsWith("/order/") || url.pathname === "/checkout" || url.pathname === "/cart") {
      res.setHeader("x-robots-tag", "noindex, nofollow, noarchive");
    }
    if (url.pathname.startsWith("/api/")) {
      await api(req, res, url);
      return;
    }
    await staticFile(req, res, url);
  } catch (error) {
    send(res, 500, { error: error.message || "Internal server error" });
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Shashlik Like API listening on http://0.0.0.0:${port}`);
  void pollTelegram();
  setInterval(() => void pollTelegram(), 5000).unref();
});
















