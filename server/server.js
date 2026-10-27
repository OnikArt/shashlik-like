import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat, rename, readdir, unlink } from "node:fs/promises";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import pg from "pg";
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
const isProduction = process.env.NODE_ENV === "production";
const databaseUrl = String(process.env.LAYERO_DATABASE_URL || process.env.DATABASE_URL || "").trim();
const storageBackend = databaseUrl ? "postgres" : "file";
const { Pool } = pg;
const databasePool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }, max: 4 }) : null;
const port = Number(process.env.PORT || 4174);
const tokenSecret = process.env.ADMIN_TOKEN_SECRET || "local-shashlik-like-secret";
const adminPassword = process.env.ADMIN_PASSWORD || "admin";
const telegramPollingEnabled = process.env.TELEGRAM_POLLING_ENABLED !== "false";
const telegramApiBaseUrl = String(process.env.TELEGRAM_API_BASE_URL || "https://api.telegram.org").trim().replace(/\/+$/, "");
const corsOriginPatterns = String(process.env.CORS_ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:4175")
  .split(",")
  .map((value) => value.trim().replace(/\/$/, ""))
  .filter(Boolean);

function parseHttpOrigin(value, variableName, { required = false, allowWildcard = false } = {}) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) {
    if (required) throw new Error(`${variableName} must be set to a full https:// origin in production`);
    return "";
  }
  const candidate = allowWildcard ? raw.replaceAll("*", "wildcard") : raw;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${variableName} must be a full URL including http:// or https://`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`${variableName} must contain only an http(s) origin without credentials, path, query or hash`);
  }
  return raw;
}

function optionalExternalUrl(value, fieldName) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error(`${fieldName}: укажите полную ссылку с https://`); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${fieldName}: допустимы только безопасные http(s)-ссылки без логина и пароля`);
  }
  return parsed.toString();
}

const publicSiteOrigin = parseHttpOrigin(process.env.PUBLIC_SITE_URL, "PUBLIC_SITE_URL", { required: isProduction });
corsOriginPatterns.forEach((origin) => parseHttpOrigin(origin, "CORS_ALLOWED_ORIGINS", { allowWildcard: true }));

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

function isAllowedCorsOrigin(origin) {
  if (!origin) return false;
  return corsOriginPatterns.some((pattern) => {
    if (!pattern.includes("*")) return origin === pattern;
    const expression = pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^./]+");
    return new RegExp(`^${expression}$`).test(origin);
  });
}

if (isProduction) {
  if (!process.env.ADMIN_TOKEN_SECRET || process.env.ADMIN_TOKEN_SECRET.length < 32) {
    throw new Error("ADMIN_TOKEN_SECRET must contain at least 32 characters in production");
  }
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === "admin" || process.env.ADMIN_PASSWORD.length < 12) {
    throw new Error("ADMIN_PASSWORD must be changed and contain at least 12 characters in production");
  }
  if (new URL(publicSiteOrigin).protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(new URL(publicSiteOrigin).hostname)) {
    throw new Error("PUBLIC_SITE_URL must use https:// in production");
  }
  if (telegramApiBaseUrl !== "https://api.telegram.org") {
    throw new Error("TELEGRAM_API_BASE_URL cannot be overridden in production");
  }
  if (!existsSync(path.join(rootDir, "dist", "index.html"))) {
    throw new Error("Production frontend build is missing: run npm run build before npm start");
  }
  if (!databaseUrl) {
    throw new Error("Persistent PostgreSQL is required in production: set LAYERO_DATABASE_URL or DATABASE_URL");
  }
}

const rolePermissions = {
  EMPLOYEE: ["orders.view", "orders.change_status", "orders.cancel", "profile.edit_self"],
  MANAGER: ["orders.view", "orders.manage", "orders.edit", "orders.archive", "orders.change_status", "orders.cancel", "products.view", "products.availability", "analytics.basic", "profile.edit_self"],
  CO_OWNER: ["orders.view", "orders.manage", "orders.edit", "orders.archive", "orders.change_status", "orders.cancel", "products.view", "products.edit", "analytics.basic", "analytics.financial", "users.view", "profile.edit_self"],
  OWNER: ["orders.view", "orders.manage", "orders.edit", "orders.archive", "orders.change_status", "orders.cancel", "products.view", "products.edit", "products.price_edit", "analytics.basic", "analytics.financial", "users.view", "users.create", "users.edit_any", "users.change_role", "settings.manage", "profile.edit_self"]
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
    telegramEvents: [...telegramEventTypes],
    telegramNotificationsEnabled: true,
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
    yandexFoodUrl: "",
    deliveryClubUrl: "",
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
    yandexFoodUrl: "",
    deliveryClubUrl: "",
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
    yandexFoodUrl: "",
    deliveryClubUrl: "",
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
    yandexFoodUrl: "",
    deliveryClubUrl: "",
    comment: "",
    isActive: true
  }
];

const telegramEventTypes = ["new_order", "accepted", "cancelled", "delivering", "completed", "catalog_changes", "staff_changes"];

function normalizeTelegramEvents(events) {
  const source = Array.isArray(events) ? events.map(String) : [...telegramEventTypes];
  const expanded = source.includes("status_changes")
    ? [...source, "accepted", "delivering", "completed"]
    : source;
  return [...new Set(expanded.filter((event) => telegramEventTypes.includes(event)))];
}

const seedStore = {
  schemaVersion: 6,
  categories: [
    { id: "shashlik", name: "Шашлыки", minPrice: "От 120 ₽ / 100 г", sortOrder: 1, isActive: true },
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
    secondaryPhone1: "",
    secondaryPhone2: "",
    telegramBrand: "@ShashlikLike",
    telegramOrders: "@iamartush1an",
    workHours: "09:00–22:00",
    deliveryPrice: 500,
    freeDeliveryFrom: 2000,
    deliveryRegions: "Правый берег Воронежа\nЦентральный район",
    yandexFoodUrl: "",
    deliveryUrl: "",
    socialUrl: "",
    maxUrl: "",
    instagramUrl: "",
    ownerTelegram: "@iamartush1an",
    minOrderAmount: 0,
    maxOrderAmount: 20000
  },
  users: [createOwnerUser()],
  auditLog: [],
  telegramLinks: [],
  telegramGroupLinks: [],
  telegramRecipients: [],
  modifierGroups: [],
  telegramUpdateOffset: 0
};

async function ensureStore() {
  if (databasePool) {
    await databasePool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        id text PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await databasePool.query(`
      CREATE TABLE IF NOT EXISTS app_media (
        id text PRIMARY KEY,
        content_type text NOT NULL,
        bytes bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const existing = await databasePool.query("SELECT 1 FROM app_state WHERE id = 'primary'");
    if (!existing.rowCount) {
      if (isProduction && process.env.ALLOW_EMPTY_DATABASE_INITIALIZATION !== "true") {
        throw new Error("PostgreSQL is empty. Import a verified backup first or explicitly set ALLOW_EMPTY_DATABASE_INITIALIZATION=true for a brand-new installation");
      }
      await databasePool.query(
        "INSERT INTO app_state (id, data) VALUES ('primary', $1::jsonb) ON CONFLICT (id) DO NOTHING",
        [JSON.stringify(seedStore)]
      );
    }
    return;
  }
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(storePath)) {
    await writeStore(seedStore);
  }
}

async function readStore() {
  await ensureStore();
  let store;
  try {
    if (databasePool) {
      const result = await databasePool.query("SELECT data FROM app_state WHERE id = 'primary'");
      if (!result.rowCount) throw new Error("PostgreSQL app_state is empty");
      store = result.rows[0].data;
    } else {
      const raw = await readFile(storePath, "utf8");
      if (!raw.trim()) throw new Error("Store is empty");
      store = JSON.parse(raw.replace(/^\\uFEFF/, ""));
    }
  } catch (error) {
    if (databasePool) {
      console.error("PostgreSQL storage read failed:", error.message);
      throw new Error("Постоянное хранилище временно недоступно");
    }
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
  if (Number(store.schemaVersion || 0) < 3) {
    for (const category of store.categories || []) {
      if (typeof category.isActive !== "boolean") category.isActive = true;
    }
    for (const addon of store.addons || []) {
      if (typeof addon.description !== "string") addon.description = "";
      if (typeof addon.imageUrl !== "string") addon.imageUrl = "";
      if (typeof addon.isCustomerVisible !== "boolean") addon.isCustomerVisible = true;
      if (!Number.isFinite(addon.sortOrder)) addon.sortOrder = 999;
    }
    for (const point of store.pickupPoints || []) {
      if (typeof point.description !== "string") point.description = "";
      if (typeof point.imageUrl !== "string") point.imageUrl = "";
      if (!Array.isArray(point.services)) point.services = [];
      if (!Number.isFinite(point.sortOrder)) point.sortOrder = 999;
    }
    store.schemaVersion = 3;
    changed = true;
  }
  if (Number(store.schemaVersion || 0) < 4) {
    store.settings ||= {};
    const settingDefaults = {
      secondaryPhone1: "",
      secondaryPhone2: "",
      maxUrl: "",
      instagramUrl: "",
      ownerTelegram: store.settings.telegramOrders || "",
      minOrderAmount: 0,
      maxOrderAmount: 20000
    };
    for (const [key, value] of Object.entries(settingDefaults)) {
      if (store.settings[key] === undefined) store.settings[key] = value;
    }
    for (const point of store.pickupPoints || []) {
      if (typeof point.yandexFoodUrl !== "string") point.yandexFoodUrl = "";
      if (typeof point.deliveryClubUrl !== "string") point.deliveryClubUrl = "";
    }
    store.schemaVersion = 4;
    changed = true;
  }
  if (Number(store.schemaVersion || 0) < 5) {
    if (!Array.isArray(store.telegramGroupLinks)) store.telegramGroupLinks = [];
    if (!Array.isArray(store.telegramRecipients)) store.telegramRecipients = [];
    for (const user of store.users || []) {
      user.telegramEvents = normalizeTelegramEvents(user.telegramEvents);
      if (typeof user.telegramNotificationsEnabled !== "boolean") user.telegramNotificationsEnabled = true;
    }
    store.schemaVersion = 5;
    changed = true;
  }
  if (Number(store.schemaVersion || 0) < 6) {
    if (!Array.isArray(store.modifierGroups)) store.modifierGroups = [];
    for (const product of store.products || []) {
      if (typeof product.freeOnionEnabled !== "boolean") product.freeOnionEnabled = /лук.*бесплат/i.test(`${product.badge || ""} ${product.description || ""}`);
      if (!Array.isArray(product.modifierGroupIds)) product.modifierGroupIds = [];
    }
    store.schemaVersion = 6;
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
  if (!Array.isArray(store.telegramGroupLinks)) {
    store.telegramGroupLinks = [];
    changed = true;
  }
  if (!Array.isArray(store.telegramRecipients)) {
    store.telegramRecipients = [];
    changed = true;
  }
  if (!Array.isArray(store.modifierGroups)) {
    store.modifierGroups = [];
    changed = true;
  }
  if (!Array.isArray(store.telegramOutbox)) {
    store.telegramOutbox = [];
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
    const normalizedEvents = normalizeTelegramEvents(user.telegramEvents);
    if (JSON.stringify(user.telegramEvents) !== JSON.stringify(normalizedEvents)) { user.telegramEvents = normalizedEvents; changed = true; }
    if (typeof user.telegramNotificationsEnabled !== "boolean") { user.telegramNotificationsEnabled = true; changed = true; }
  }
  for (const recipient of store.telegramRecipients) {
    const normalizedEvents = normalizeTelegramEvents(recipient.events);
    if (JSON.stringify(recipient.events) !== JSON.stringify(normalizedEvents)) { recipient.events = normalizedEvents; changed = true; }
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
    if (typeof product.freeOnionEnabled !== "boolean") { product.freeOnionEnabled = /лук.*бесплат/i.test(`${product.badge || ""} ${product.description || ""}`); changed = true; }
    if (!Array.isArray(product.modifierGroupIds)) { product.modifierGroupIds = []; changed = true; }
    if (!Array.isArray(product.images) || !product.images.length) {
      product.images = [product.imageUrl || "/assets/placeholder.svg"];
      changed = true;
    } else {
      product.images = [...new Set(product.images.map(String).filter(Boolean))].slice(0, 8);
    }
    if (product.imageUrl !== product.images[0]) {
      product.imageUrl = product.images[0] || "/assets/placeholder.svg";
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
    if (typeof order.archivedAt !== "string") { order.archivedAt = ""; changed = true; }
    if (typeof order.archivedByUserId !== "string") { order.archivedByUserId = ""; changed = true; }
    if (!Array.isArray(order.changeLog)) { order.changeLog = []; changed = true; }
  }
  if (changed) await writeStore(store);
  return store;
}

let storeWriteQueue = Promise.resolve();

function writeStore(store) {
  const snapshot = JSON.stringify(store, null, 2);
  const operation = storeWriteQueue.then(async () => {
    if (databasePool) {
      const result = await databasePool.query(
        "UPDATE app_state SET data = $1::jsonb, updated_at = now() WHERE id = 'primary'",
        [snapshot]
      );
      if (!result.rowCount) throw new Error("PostgreSQL app_state is not initialized");
      return;
    }
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

function publicOrderDto(order, store) {
  const productsById = new Map((store?.products || []).map((product) => [product.id, product]));
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    statusLabel: orderStatusLabels[order.status],
    publicStatus: order.status,
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
      productId: item.productId,
      name: item.name,
      imageUrl: productsById.get(item.productId)?.imageUrl || "/assets/placeholder.svg",
      quantity: item.quantity,
      quantityLabel: item.quantityLabel,
      option: item.option,
      onionChoice: item.onionChoice || "",
      addons: item.addons.map((addon) => ({ name: addon.name })),
      modifiers: (item.modifiers || []).map((group) => ({ groupName: group.groupName, options: group.options.map((option) => ({ name: option.name })) })),
      total: item.total
    })),
    subtotal: order.subtotal,
    deliveryPrice: order.deliveryPrice,
    total: order.total,
    pickupPointName: order.fulfillmentType === "pickup" ? order.pickupPointName : "",
    address: order.fulfillmentType === "delivery" ? order.address : "",
    apartment: order.fulfillmentType === "delivery" ? order.apartment : "",
    entrance: order.fulfillmentType === "delivery" ? order.entrance : "",
    floor: order.fulfillmentType === "delivery" ? order.floor : "",
    intercom: order.fulfillmentType === "delivery" ? order.intercom : "",
    comment: order.comment || "",
    paymentMethod: order.paymentMethod || "PAY_ON_DELIVERY",
    canReview: order.status === "completed" && !order.review,
    review: order.review ? {
      rating: order.review.rating,
      comment: order.review.comment,
      createdAt: order.review.createdAt
    } : null
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
    return { order, changed: true, idempotent: false, statusNotificationChats: notificationChats(store, targetStatus) };
  });
}

async function readJson(req, maxBytes = 128 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
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
    categories: store.categories.filter((category) => category.isActive !== false).sort((a, b) => a.sortOrder - b.sortOrder),
    products: store.products.filter((p) => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    addons: store.addons.filter((a) => a.isActive && a.isCustomerVisible !== false).sort((a, b) => (a.sortOrder || 999) - (b.sortOrder || 999)),
    modifierGroups: (store.modifierGroups || []).filter((group) => group.isActive !== false),
    pickupPoints: store.pickupPoints.filter((p) => p.isActive).sort((a, b) => (a.sortOrder || 999) - (b.sortOrder || 999)),
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
  const { telegramLinks, telegramGroupLinks, telegramUpdateOffset, telegramOutbox, analyticsEvents, users, auditLog, ...safeStore } = store;
  return {
    ...safeStore,
    orders: store.orders.map((order) => ({ ...order, availableTransitions: availableOrderTransitions(order) })),
    orderStatusHistory: store.orderStatusHistory,
    users: (hasPermission(currentUser, "users.view") ? store.users : store.users.filter((user) => user.id === currentUser.id)).map(serializeUser),
    auditLog: hasPermission(currentUser, "orders.manage") || hasPermission(currentUser, "users.view") ? store.auditLog : [],
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
    telegramEvents: Array.isArray(input.telegramEvents)
      ? normalizeTelegramEvents(input.telegramEvents)
      : Array.isArray(fallback.telegramEvents) ? [...fallback.telegramEvents] : [...telegramEventTypes],
    telegramNotificationsEnabled: Boolean(input.telegramNotificationsEnabled ?? fallback.telegramNotificationsEnabled ?? true),
    isActive: Boolean(input.isActive ?? fallback.isActive ?? true),
    createdAt: fallback.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastLoginAt: fallback.lastLoginAt || ""
  };
}

function normalizeRussianPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("9")) digits = `7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  return digits.length === 11 && digits.startsWith("79") ? `+${digits}` : "";
}

function calculateOrder(store, payload) {
  const settings = store.settings;
  const productsById = new Map(store.products.map((product) => [product.id, product]));
  const addonsById = new Map(store.addons.map((addon) => [addon.id, addon]));
  const modifierGroupsById = new Map((store.modifierGroups || []).map((group) => [group.id, group]));
  const items = [];
  const requestedItems = Array.isArray(payload.items) ? payload.items : [];
  if (requestedItems.length > 100) throw new Error("В заказе слишком много позиций");

  for (const item of requestedItems) {
    if (!item || typeof item !== "object") throw new Error("Некорректная позиция заказа");
    const product = productsById.get(item.productId);
    if (!product || !product.isActive || !product.isAvailable) {
      throw new Error("Товар недоступен");
    }
    const quantity = Number(item.quantity);
    const step = Math.max(Number(product.step || 1), 1);
    const quantityInSteps = quantity / step;
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantityInSteps) || quantityInSteps > 100) {
      throw new Error("Некорректное количество товара «" + product.name + "»");
    }
    const allowedOptions = Array.isArray(product.options) ? product.options.map(String) : [];
    const option = String(item.option || "").trim();
    if ((allowedOptions.length && !allowedOptions.includes(option)) || (!allowedOptions.length && option)) {
      throw new Error("Недоступный вариант товара «" + product.name + "»");
    }
    const allowedAddonIds = new Set(product.addonIds || []);
    const requestedAddonIds = Array.isArray(item.addons) ? item.addons.map(String) : [];
    if (new Set(requestedAddonIds).size !== requestedAddonIds.length || requestedAddonIds.some((id) => !allowedAddonIds.has(id))) {
      throw new Error("Одно из дополнений для товара «" + product.name + "» недоступно");
    }
    const addons = requestedAddonIds
      .map((id) => addonsById.get(id))
      .filter((addon) => addon?.isActive)
      .map((addon) => ({ id: addon.id, name: addon.name, price: addon.price }));
    if (addons.length !== requestedAddonIds.length) {
      throw new Error("Одно из дополнений для товара «" + product.name + "» недоступно");
    }
    const addonsTotal = addons.reduce((sum, addon) => sum + addon.price, 0);
    const requestedModifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
    const requestedByGroup = new Map(requestedModifiers.map((selection) => [String(selection?.groupId || ""), Array.isArray(selection?.optionIds) ? selection.optionIds.map(String) : []]));
    const modifiers = [];
    for (const groupId of product.modifierGroupIds || []) {
      const group = modifierGroupsById.get(groupId);
      if (!group || group.isActive === false) continue;
      const available = (group.options || []).filter((option) => option.isActive !== false);
      const defaults = available.filter((option) => option.defaultSelected).map((option) => option.id);
      const optionIds = requestedByGroup.has(groupId) ? [...new Set(requestedByGroup.get(groupId))] : defaults;
      const min = group.required ? Math.max(1, Number(group.minSelections || 1)) : Math.max(0, Number(group.minSelections || 0));
      const max = group.selection === "single" ? 1 : Math.max(min, Number(group.maxSelections || available.length));
      if (optionIds.length < min || optionIds.length > max) throw new Error(`Проверьте выбор «${group.name}» для товара «${product.name}»`);
      const selected = optionIds.map((id) => available.find((option) => option.id === id)).filter(Boolean);
      if (selected.length !== optionIds.length) throw new Error(`Недоступный модификатор товара «${product.name}»`);
      modifiers.push({ groupId: group.id, groupName: group.name, options: selected.map((option) => ({ id: option.id, name: option.name, price: Number(option.price || 0) })) });
    }
    if ([...requestedByGroup.keys()].some((groupId) => !(product.modifierGroupIds || []).includes(groupId))) throw new Error(`Недоступная группа модификаторов товара «${product.name}»`);
    const onionChoice = product.freeOnionEnabled ? (item.onionChoice === "without" ? "without" : "with") : "";
    if (!product.freeOnionEnabled && item.onionChoice) throw new Error(`Выбор лука недоступен для товара «${product.name}»`);
    const modifierTotal = modifiers.reduce((sum, group) => sum + group.options.reduce((groupSum, option) => groupSum + option.price, 0), 0);
    const lineTotal = lineItemTotal(product, quantity, addonsTotal + modifierTotal);
    items.push({
      productId: product.id,
      name: product.name,
      unit: product.unit,
      price: product.price,
      quantity,
      quantityLabel: quantityLabel(product, quantity),
      option,
      onionChoice,
      addons,
      modifiers,
      total: lineTotal
    });
  }

  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const deliveryType = payload.deliveryType === "pickup" ? "pickup" : "delivery";
  const deliveryPrice = deliveryType === "delivery" && subtotal < settings.freeDeliveryFrom ? settings.deliveryPrice : 0;
  return { items, subtotal, deliveryPrice, total: subtotal + deliveryPrice, deliveryType };
}

function sanitizeCategory(input, fallback = {}) {
  const name = String(input.name ?? fallback.name ?? "").trim();
  if (!name) throw new Error("Укажите название категории");
  return {
    id: fallback.id || String(input.id || crypto.randomUUID()).trim(),
    name,
    minPrice: String(input.minPrice ?? fallback.minPrice ?? "").trim(),
    sortOrder: Math.max(0, Number(input.sortOrder ?? fallback.sortOrder ?? 999)),
    isActive: Boolean(input.isActive ?? fallback.isActive ?? true)
  };
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
    "Оплата: " + (order.paymentMethod === "TRANSFER_ON_DELIVERY" ? "переводом при получении" : order.paymentMethod === "CASH_ON_DELIVERY" ? "наличными при получении" : "картой при получении"),
    "",
    "ЗАКАЗ:"
  ];
  order.items.forEach((item, index) => {
    const addons = item.addons.length ? " + " + item.addons.map((addon) => addon.name).join(", ") : "";
    const modifiers = (item.modifiers || []).flatMap((group) => group.options.map((option) => option.name));
    const modifierText = modifiers.length ? " + " + modifiers.join(", ") : "";
    const onion = item.onionChoice ? ` (${item.onionChoice === "without" ? "без лука" : "с луком"})` : "";
    const option = item.option ? " (" + item.option + ")" : "";
    lines.push((index + 1) + ". " + item.name + option + onion + addons + modifierText);
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
  const response = await fetch(telegramApiBaseUrl + "/bot" + token + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.description || "Telegram HTTP " + response.status);
  return payload.result;
}

async function telegramRequestWithRetry(method, body, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await telegramRequest(method, body);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function sendTelegramText(chatIds, text, options = {}) {
  if (process.env.TELEGRAM_DISABLED === "true") return { sent: false, sentCount: 0, recipientCount: 0, failedChatIds: [], reason: "disabled" };
  const uniqueChatIds = [...new Set(chatIds.map(String).filter(Boolean))];
  if (!uniqueChatIds.length) return { sent: false, sentCount: 0, recipientCount: 0, failedChatIds: [], reason: "no_recipients" };
  const settled = await Promise.allSettled(uniqueChatIds.map((chatId) => telegramRequestWithRetry("sendMessage", { chat_id: chatId, text, ...options })));
  const sent = settled.filter((result) => result.status === "fulfilled").length;
  const firstError = settled.find((result) => result.status === "rejected");
  return {
    sent: sent > 0,
    sentCount: sent,
    recipientCount: uniqueChatIds.length,
    failedChatIds: uniqueChatIds.filter((_, index) => settled[index].status === "rejected"),
    reason: firstError?.reason?.message || ""
  };
}

function connectedChats(store, filter = () => true) {
  return store.users.filter((user) => user.isActive && user.telegramChatId && filter(user)).map((user) => user.telegramChatId);
}

function notificationChats(store, eventType, filter = () => true) {
  return [...new Set([...personalNotificationChats(store, eventType, filter), ...groupNotificationChats(store, eventType)].map(String).filter(Boolean))];
}

function personalNotificationChats(store, eventType, filter = () => true) {
  return store.users
    .filter((user) => user.isActive && user.telegramChatId && user.telegramNotificationsEnabled !== false && filter(user))
    .filter((user) => !eventType || !Array.isArray(user.telegramEvents) || user.telegramEvents.includes(eventType))
    .map((user) => user.telegramChatId);
}

function groupNotificationChats(store, eventType) {
  return (store.telegramRecipients || [])
    .filter((recipient) => recipient.type === "group" && recipient.isActive !== false)
    .filter((recipient) => !eventType || !Array.isArray(recipient.events) || recipient.events.includes(eventType))
    .map((recipient) => recipient.chatId);
}

function telegramGroupOrderMessage(order) {
  const lines = [
    `🔥 Заказ #${order.orderNumber}`,
    `Статус: ${orderStatusLabels[order.status]}`,
    `Получение: ${order.deliveryType === "pickup" ? "Самовывоз" : "Доставка"}`,
    "",
    "СОСТАВ:"
  ];
  for (const [index, item] of order.items.entries()) {
    const details = [item.option, item.onionChoice === "without" ? "без лука" : item.onionChoice === "with" ? "с луком" : "", ...(item.addons || []).map((addon) => addon.name), ...(item.modifiers || []).flatMap((group) => group.options.map((option) => option.name))].filter(Boolean);
    lines.push(`${index + 1}. ${item.name}${details.length ? ` (${details.join(", ")})` : ""}`);
    lines.push(`${item.quantityLabel} — ${item.total} ₽`);
  }
  lines.push("", `ИТОГО: ${order.total} ₽`, "Контакты клиента доступны сотрудникам в админ-панели.");
  return lines.join("\n");
}

async function sendOrderTelegram(store, order) {
  if (process.env.TELEGRAM_DISABLED === "true") return { sent: false, reason: "disabled", messages: [] };
  const personalRecipients = personalNotificationChats(store, "new_order");
  if (process.env.TELEGRAM_CHAT_ID) personalRecipients.push(process.env.TELEGRAM_CHAT_ID);
  const groupRecipients = groupNotificationChats(store, "new_order");
  const uniquePersonal = [...new Set(personalRecipients.map(String).filter(Boolean))];
  const uniqueGroups = [...new Set(groupRecipients.map(String).filter(Boolean))].filter((chatId) => !uniquePersonal.includes(chatId));
  const uniqueRecipients = [...uniquePersonal, ...uniqueGroups];
  if (!uniqueRecipients.length) {
    return {
      sent: false,
      sentCount: 0,
      recipientCount: 0,
      failedChatIds: [],
      messages: [],
      reason: "no_recipients"
    };
  }
  const settled = await Promise.allSettled(uniqueRecipients.map((chatId) => telegramRequestWithRetry("sendMessage", {
    chat_id: chatId,
    text: uniqueGroups.includes(chatId) ? telegramGroupOrderMessage(order) : telegramMessage(order),
    reply_markup: telegramOrderKeyboard(order)
  })));
  const messages = settled.flatMap((result, index) => result.status === "fulfilled"
    ? [{ chatId: uniqueRecipients[index], messageId: result.value.message_id, audience: uniqueGroups.includes(uniqueRecipients[index]) ? "group" : "personal" }]
    : []);
  const firstError = settled.find((result) => result.status === "rejected");
  return {
    sent: messages.length > 0,
    sentCount: messages.length,
    recipientCount: uniqueRecipients.length,
    failedChatIds: uniqueRecipients.filter((_, index) => settled[index].status === "rejected"),
    messages,
    reason: firstError?.reason?.message || ""
  };
}

async function refreshOrderTelegram(order) {
  const messages = order.telegram?.messages || [];
  await Promise.allSettled(messages.map((message) => telegramRequestWithRetry("editMessageText", {
    chat_id: message.chatId,
    message_id: message.messageId,
    text: message.audience === "group" ? telegramGroupOrderMessage(order) : telegramMessage(order),
    reply_markup: telegramOrderKeyboard(order)
  })));
}

async function sendOrderStatusNotification(result) {
  if (result.idempotent || !result.statusNotificationChats?.length) return;
  await sendTelegramText(
    result.statusNotificationChats,
    `🔔 Заказ #${result.order.orderNumber}\n${orderStatusLabels[result.order.status]}`
  );
}

function changeLabel(key) {
  return ({
    name: "название",
    description: "описание",
    price: "цена",
    unit: "единица",
    categoryId: "категория",
    imageUrl: "главное фото",
    images: "фотографии",
    customerName: "клиент",
    deliveryType: "способ получения",
    address: "адрес",
    pickupPointName: "киоск",
    comment: "комментарий",
    items: "состав заказа",
    subtotal: "стоимость товаров",
    deliveryPrice: "стоимость доставки",
    total: "итого",
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
  if (Array.isArray(value)) return value.length ? value.map((item) => typeof item === "object" && item ? `${item.name || item.productId || "позиция"}${item.quantityLabel ? ` · ${item.quantityLabel}` : ""}` : String(item)).join(", ") : "нет";
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

function escapeTelegramHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  const eventType = scope === "users" ? "staff_changes" : "catalog_changes";
  const recipients = notificationChats(store, eventType, (user) => !managementOnly || ["MANAGER", "CO_OWNER", "OWNER"].includes(user.role));
  const text = [
    "🔥 <b>" + escapeTelegramHtml(action.toUpperCase()) + "</b>",
    "",
    "📦 <b>Объект:</b> " + escapeTelegramHtml(subject),
    ...(changes.length ? ["", "📝 <b>Изменения:</b>", ...changes.map((change) => "• " + escapeTelegramHtml(change))] : []),
    "",
    "👤 <b>Изменил:</b> " + escapeTelegramHtml(entry.actor),
    "🕒 <b>Время:</b> " + escapeTelegramHtml(new Date(entry.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })),
    "",
    "✅ Изменения сохранены"
  ].join("\n");
  const delivery = await sendTelegramText(recipients, text, { parse_mode: "HTML", disable_web_page_preview: true });
  for (const chatId of delivery.failedChatIds || []) {
    store.telegramOutbox.push({ id: crypto.randomUUID(), chatId, text, parseMode: "HTML", attempts: 0, nextAttemptAt: Date.now() + 60_000, createdAt: entry.createdAt });
  }
  store.telegramOutbox = store.telegramOutbox.slice(-500);
  return entry;
}

async function flushTelegramOutbox() {
  if (!process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_DISABLED === "true") return;
  await mutateStore(async (store) => {
    const now = Date.now();
    const due = store.telegramOutbox.filter((entry) => Number(entry.nextAttemptAt || 0) <= now).slice(0, 10);
    if (!due.length) return { changed: false };
    const completed = new Set();
    for (const entry of due) {
      try {
        const body = entry.body || { chat_id: entry.chatId, text: entry.text, parse_mode: entry.parseMode || "HTML", disable_web_page_preview: true };
        const result = await telegramRequestWithRetry(entry.method || "sendMessage", body, 2);
        if (entry.orderId && result?.message_id) {
          const order = store.orders.find((item) => item.id === entry.orderId);
          if (order) {
            order.telegram ||= { sent: false, sentCount: 0, recipientCount: 0, messages: [], reason: "" };
            order.telegram.messages ||= [];
            if (!order.telegram.messages.some((message) => String(message.chatId) === String(body.chat_id))) {
              order.telegram.messages.push({ chatId: body.chat_id, messageId: result.message_id });
              order.telegram.sentCount = order.telegram.messages.length;
            }
            order.telegram.sent = true;
            order.telegram.reason = "";
          }
        }
        completed.add(entry.id);
      } catch {
        entry.attempts = Number(entry.attempts || 0) + 1;
        entry.nextAttemptAt = now + Math.min(30 * 60_000, 60_000 * 2 ** entry.attempts);
        if (entry.attempts >= 6) completed.add(entry.id);
      }
    }
    store.telegramOutbox = store.telegramOutbox.filter((entry) => !completed.has(entry.id));
    return { changed: true };
  });
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
  const groupCommand = String(message.text || "").trim().match(/^\/connectgroup(?:@\w+)?\s+([A-F0-9]{8,32})$/i);
  if (groupCommand && ["group", "supergroup"].includes(message.chat?.type)) {
    const result = await mutateStore(async (store) => {
      const index = (store.telegramGroupLinks || []).findIndex((link) => link.code === groupCommand[1].toUpperCase() && link.expiresAt > Date.now());
      if (index === -1) return { error: "Код подключения группы не найден или истёк", changed: false };
      const link = store.telegramGroupLinks[index];
      const chatId = String(message.chat.id);
      const recipient = {
        id: crypto.randomUUID(),
        type: "group",
        chatId,
        title: String(message.chat.title || "Telegram-группа").slice(0, 120),
        events: [...telegramEventTypes],
        isActive: true,
        connectedAt: new Date().toISOString(),
        connectedByTelegramUserId: String(message.from?.id || "")
      };
      const existingIndex = (store.telegramRecipients || []).findIndex((item) => String(item.chatId) === chatId);
      if (existingIndex >= 0) store.telegramRecipients[existingIndex] = { ...store.telegramRecipients[existingIndex], ...recipient, id: store.telegramRecipients[existingIndex].id };
      else store.telegramRecipients.push(recipient);
      store.telegramGroupLinks.splice(index, 1);
      return { recipient, link, changed: true };
    });
    await sendTelegramText([message.chat.id], result.error || `Группа «${result.recipient.title}» подключена к уведомлениям.`);
    return;
  }
  const result = await mutateStore(async (store) => ({ ...createTelegramLink(store, message), changed: true }));
  if (result.existing) {
    await sendTelegramText([message.chat.id], "Вы уже подключены как " + userNameForAudit(result.existing) + " (" + roleLabels[result.existing.role] + ").");
  } else {
    await sendTelegramText([message.chat.id], "Код подключения: " + result.code + "\nПередайте его владельцу. Код действует 30 минут и используется один раз.");
  }
}

const processedTelegramCallbacks = new Map();
async function handleTelegramCallback(callback) {
  const callbackId = callback.id;
  const now = Date.now();
  for (const [id, timestamp] of processedTelegramCallbacks) if (now - timestamp > 10 * 60_000) processedTelegramCallbacks.delete(id);
  if (processedTelegramCallbacks.has(callbackId)) {
    await telegramRequest("answerCallbackQuery", { callback_query_id: callbackId, text: "Действие уже обработано" });
    return;
  }
  processedTelegramCallbacks.set(callbackId, now);
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
    await sendOrderStatusNotification(result);
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
    await flushTelegramOutbox();
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
  const name = String(input.name ?? fallback.name ?? "").trim();
  const price = Number(input.price ?? fallback.price ?? 0);
  const step = Number(input.step ?? fallback.step ?? 1);
  if (!name) throw new Error("Укажите название товара");
  if (!Number.isFinite(price) || price < 0) throw new Error("Цена товара должна быть неотрицательным числом");
  if (!Number.isFinite(step) || step <= 0) throw new Error("Шаг количества должен быть положительным числом");
  const fallbackImages = Array.isArray(fallback.images) && fallback.images.length
    ? fallback.images
    : [fallback.imageUrl || "/assets/placeholder.svg"];
  const requestedImages = Array.isArray(input.images) ? input.images : fallbackImages;
  const images = [...new Set(requestedImages.map((value) => String(value || "").trim()).filter((value) => /^(\/|https?:\/\/)/i.test(value)))].slice(0, 8);
  const requestedMainCandidate = String(input.imageUrl || images[0] || fallback.imageUrl || "/assets/placeholder.svg").trim();
  const requestedMain = /^(\/|https?:\/\/)/i.test(requestedMainCandidate) ? requestedMainCandidate : (images[0] || "/assets/placeholder.svg");
  const normalizedImages = [requestedMain, ...images.filter((value) => value !== requestedMain)].slice(0, 8);
  const options = [...new Set((Array.isArray(input.options) ? input.options : fallback.options || []).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 24);
  const addonIds = [...new Set((Array.isArray(input.addonIds) ? input.addonIds : fallback.addonIds || []).map(String))].slice(0, 64);
  const modifierGroupIds = [...new Set((Array.isArray(input.modifierGroupIds) ? input.modifierGroupIds : fallback.modifierGroupIds || []).map(String))].slice(0, 32);
  return {
    id: input.id || fallback.id || crypto.randomUUID(),
    slug: input.slug || fallback.slug || String(input.name || "product").toLowerCase().replace(/\s+/g, "-"),
    name,
    description: String(input.description || fallback.description || "").trim(),
    price,
    unit: String(input.unit || fallback.unit || "1 шт").trim(),
    step,
    categoryId: String(input.categoryId || fallback.categoryId || "shashlik"),
    imageUrl: normalizedImages[0] || "/assets/placeholder.svg",
    images: normalizedImages.length ? normalizedImages : ["/assets/placeholder.svg"],
    isActive: Boolean(input.isActive ?? fallback.isActive ?? true),
    isAvailable: Boolean(input.isAvailable ?? fallback.isAvailable ?? true),
    isFeatured: Boolean(input.isFeatured ?? fallback.isFeatured ?? false),
    badge: String(input.badge || fallback.badge || ""),
    options,
    addonGroup: input.addonGroup || fallback.addonGroup || "",
    addonIds,
    modifierGroupIds,
    freeOnionEnabled: Boolean(input.freeOnionEnabled ?? fallback.freeOnionEnabled ?? false),
    sortOrder: Number(input.sortOrder ?? fallback.sortOrder ?? 999)
  };
}

function sanitizeModifierGroup(input, fallback = {}) {
  const name = String(input.name ?? fallback.name ?? "").trim();
  if (!name) throw new Error("Укажите название группы модификаторов");
  const selection = input.selection === "multiple" ? "multiple" : "single";
  const options = (Array.isArray(input.options) ? input.options : fallback.options || []).map((option, index) => ({
    id: String(option.id || crypto.randomUUID()),
    name: String(option.name || "").trim(),
    price: Math.max(0, Number(option.price || 0)),
    isActive: Boolean(option.isActive ?? true),
    defaultSelected: Boolean(option.defaultSelected),
    sortOrder: Math.max(0, Number(option.sortOrder ?? index))
  })).filter((option) => option.name).slice(0, 50);
  if (!options.length) throw new Error("Добавьте хотя бы один вариант");
  const required = Boolean(input.required ?? fallback.required ?? false);
  const minSelections = selection === "single" ? (required ? 1 : 0) : Math.max(required ? 1 : 0, Number(input.minSelections ?? fallback.minSelections ?? 0));
  const maxSelections = selection === "single" ? 1 : Math.max(minSelections, Math.min(options.length, Number(input.maxSelections ?? fallback.maxSelections ?? options.length)));
  if (selection === "single" && options.filter((option) => option.defaultSelected).length > 1) throw new Error("В одиночном выборе может быть только один вариант по умолчанию");
  return {
    id: fallback.id || String(input.id || crypto.randomUUID()),
    name,
    selection,
    required,
    minSelections,
    maxSelections,
    options,
    isActive: Boolean(input.isActive ?? fallback.isActive ?? true),
    sortOrder: Math.max(0, Number(input.sortOrder ?? fallback.sortOrder ?? 999))
  };
}

async function sendHealth(res) {
  const checks = {
    frontend: !isProduction || existsSync(path.join(rootDir, "dist", "index.html")),
    store: false,
    persistentStorage: storageBackend === "postgres"
  };
  try {
    const store = await readStore();
    checks.store = Boolean(store && Array.isArray(store.products) && Array.isArray(store.orders) && Array.isArray(store.users));
  } catch (error) {
    console.error("Health store check failed:", error.message);
  }
  const ready = checks.frontend && checks.store;
  return send(res, ready ? 200 : 503, {
    status: ready ? "ok" : "unavailable",
    service: "shashlik-like",
    storage: storageBackend,
    checks,
    uptime: Math.round(process.uptime())
  });
}

async function api(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendHealth(res);
  }

  const mediaMatch = url.pathname.match(/^\/api\/media\/([a-f0-9-]{36})$/);
  if (req.method === "GET" && mediaMatch && databasePool) {
    const result = await databasePool.query("SELECT content_type, bytes FROM app_media WHERE id = $1", [mediaMatch[1]]);
    if (!result.rowCount) return notFound(res);
    res.writeHead(200, {
      "content-type": result.rows[0].content_type,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff"
    });
    res.end(result.rows[0].bytes);
    return;
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
    return send(res, 200, { order: publicOrderDto(order, store) });
  }

  const reviewMatch = url.pathname.match(/^\/api\/orders\/track\/([A-Za-z0-9_-]{40,})\/review$/);
  if (req.method === "POST" && reviewMatch) {
    if (!enforceRateLimit(req, res, "order-review", 6, 60 * 60_000)) return;
    try {
      const payload = await readJson(req);
      const rating = Number(payload.rating);
      const comment = String(payload.comment || "").trim().slice(0, 500);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return send(res, 400, { error: "Выберите оценку от 1 до 5" });
      }
      const result = await mutateStore(async (freshStore) => {
        const order = freshStore.orders.find((item) => item.trackingToken === reviewMatch[1]);
        if (!order) return { notFound: true, changed: false };
        if (order.status !== "completed") return { unavailable: true, changed: false };
        if (order.review) return { duplicate: true, order, store: freshStore, changed: false };
        order.review = { rating, comment, createdAt: new Date().toISOString() };
        return { order, store: freshStore };
      });
      if (result.notFound) return send(res, 404, { error: "Заказ не найден" });
      if (result.unavailable) return send(res, 409, { error: "Оценить заказ можно после его выполнения" });
      if (result.duplicate) return send(res, 409, { error: "Отзыв по этому заказу уже отправлен", order: publicOrderDto(result.order, result.store) });
      return send(res, 201, { order: publicOrderDto(result.order, result.store) });
    } catch (error) {
      return send(res, error.httpStatus || 400, { error: error.message || "Не удалось отправить отзыв" });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/orders") {
    if (!enforceRateLimit(req, res, "checkout", 12, 10 * 60_000)) return;
    try {
      const payload = await readJson(req);
      const created = await mutateStore(async (freshStore) => {
        const calculated = calculateOrder(freshStore, payload);
        if (!calculated.items.length) throw new Error("Корзина пуста");
        const minimum = Math.max(0, Number(freshStore.settings.minOrderAmount || 0));
        const maximum = Math.max(minimum, Number(freshStore.settings.maxOrderAmount || Number.MAX_SAFE_INTEGER));
        if (calculated.subtotal < minimum) throw new Error(`Минимальная сумма заказа — ${minimum} ₽`);
        if (calculated.subtotal > maximum) throw new Error(`Максимальная сумма заказа — ${maximum} ₽`);
        const customerName = String(payload.customerName || "").trim().slice(0, 80);
        const phone = normalizeRussianPhone(payload.phone);
        if (!customerName || !phone) throw new Error("Укажите имя и корректный российский номер телефона");

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
          paymentMethod: ["CARD_ON_DELIVERY", "TRANSFER_ON_DELIVERY", "CASH_ON_DELIVERY"].includes(payload.paymentMethod)
            ? payload.paymentMethod
            : "CARD_ON_DELIVERY",
          status: "new",
          archivedAt: "",
          archivedByUserId: "",
          changeLog: [],
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
          if (savedOrder) {
            savedOrder.telegram = telegram;
            for (const chatId of telegram.failedChatIds || []) {
              freshStore.telegramOutbox.push({
                id: crypto.randomUUID(),
                method: "sendMessage",
                body: { chat_id: chatId, text: telegramMessage(savedOrder), reply_markup: telegramOrderKeyboard(savedOrder) },
                orderId: savedOrder.id,
                attempts: 0,
                nextAttemptAt: Date.now() + 60_000,
                createdAt: new Date().toISOString()
              });
            }
            freshStore.telegramOutbox = freshStore.telegramOutbox.slice(-500);
          }
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
    const login = String(payload.login || "").trim();
    if (!login || !payload.password) return send(res, 400, { error: "Введите логин и пароль" });
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

  if (req.method === "POST" && url.pathname === "/api/admin/uploads") {
    if (!hasPermission(adminUser, "products.edit") && !hasPermission(adminUser, "settings.manage") && !hasPermission(adminUser, "profile.edit_self")) return forbid(res);
    const payload = await readJson(req, 7 * 1024 * 1024);
    const match = String(payload.dataUrl || "").match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return send(res, 400, { error: "Поддерживаются PNG, JPG и WebP" });
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length || buffer.length > 5 * 1024 * 1024) return send(res, 413, { error: "Размер изображения не должен превышать 5 МБ" });
    const detectedType = buffer.length >= 12 && buffer[0] === 0x89 && buffer.subarray(1, 4).toString("ascii") === "PNG"
      ? "png"
      : buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
        ? "jpeg"
        : buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP"
          ? "webp"
          : "";
    if (!detectedType || detectedType !== match[1]) return send(res, 400, { error: "Содержимое файла не соответствует формату изображения" });
    if (databasePool) {
      const mediaId = crypto.randomUUID();
      await databasePool.query(
        "INSERT INTO app_media (id, content_type, bytes) VALUES ($1, $2, $3)",
        [mediaId, `image/${detectedType}`, buffer]
      );
      return send(res, 201, { url: `/api/media/${mediaId}` });
    }
    const extension = detectedType === "jpeg" ? "jpg" : detectedType;
    const uploadsDir = path.join(rootDir, "public", "uploads");
    await mkdir(uploadsDir, { recursive: true });
    const fileName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${extension}`;
    await writeFile(path.join(uploadsDir, fileName), buffer);
    return send(res, 201, { url: `/uploads/${fileName}` });
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
    const disconnected = payload.telegramDisconnect === true && Boolean(next.telegramChatId || next.telegramUserId);
    if (disconnected) {
      next.telegramChatId = "";
      next.telegramUserId = "";
      next.telegramUsername = "";
    }
    let linked = false;
    try {
      if (payload.telegramDisconnect === true && payload.telegramLinkCode) throw new Error("Нельзя одновременно отвязать и подключить Telegram");
      linked = Boolean(applyTelegramLink(store, next, payload.telegramLinkCode));
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
    store.users[userIndex] = next;
    const changes = describeChanges(before, next, ["firstName", "lastName", "role", "position", "phone", "workPointId", "shiftType", "isActive"]);
    if (linked) changes.push("Telegram: подключён");
    if (disconnected) changes.push("Telegram: отвязан");
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

  if (req.method === "POST" && url.pathname === "/api/admin/categories") {
    if (!ensurePermission(adminUser, res, "products.edit")) return;
    try {
      const category = sanitizeCategory(await readJson(req));
      if (store.categories.some((item) => item.id === category.id)) return send(res, 409, { error: "Категория уже существует" });
      store.categories.push(category);
      await notifyAudit(store, adminUser, "products", "Добавлена категория", category.name);
      await writeStore(store);
      return send(res, 201, { category });
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
  }

  const categoryMatch = url.pathname.match(/^\/api\/admin\/categories\/([^/]+)$/);
  if (categoryMatch) {
    if (!ensurePermission(adminUser, res, "products.edit")) return;
    const categoryId = decodeURIComponent(categoryMatch[1]);
    const categoryIndex = store.categories.findIndex((category) => category.id === categoryId);
    if (categoryIndex === -1) return notFound(res);
    if (req.method === "PUT") {
      try {
        const before = store.categories[categoryIndex];
        const next = sanitizeCategory(await readJson(req), before);
        store.categories[categoryIndex] = next;
        await notifyAudit(store, adminUser, "products", "Изменена категория", next.name, describeChanges(before, next, ["name", "minPrice", "sortOrder", "isActive"]));
        await writeStore(store);
        return send(res, 200, { category: next });
      } catch (error) {
        return send(res, 400, { error: error.message });
      }
    }
    if (req.method === "DELETE") {
      const linked = store.products.filter((product) => product.categoryId === categoryId);
      if (linked.length) return send(res, 409, { error: `Категория используется в ${linked.length} товарах. Сначала перенесите или отключите их.` });
      const removed = store.categories.splice(categoryIndex, 1)[0];
      await notifyAudit(store, adminUser, "products", "Удалена категория", removed.name);
      await writeStore(store);
      return send(res, 200, { ok: true });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/admin/products") {
    if (!ensurePermission(adminUser, res, "products.edit")) return;
    try {
      const payload = await readJson(req);
      if (Number(payload.price || 0) !== 0 && !hasPermission(adminUser, "products.price_edit")) return send(res, 403, { error: "Недостаточно прав для назначения цены" });
      const product = sanitizeProduct(payload);
      if (!store.categories.some((category) => category.id === product.categoryId)) return send(res, 400, { error: "Выберите существующую категорию" });
      if (product.addonIds.some((id) => !store.addons.some((addon) => addon.id === id))) return send(res, 400, { error: "Выбрано несуществующее дополнение" });
      if (product.modifierGroupIds.some((id) => !store.modifierGroups.some((group) => group.id === id))) return send(res, 400, { error: "Выбрана несуществующая группа модификаторов" });
      store.products.push(product);
      await notifyAudit(store, adminUser, "products", "Добавлен товар", product.name, [
        "цена: " + product.price + " ₽",
        "варианты: " + formatChangedValue(product.options),
        "дополнения: " + formatChangedValue(product.addonIds)
      ]);
      await writeStore(store);
      return send(res, 201, { product });
    } catch (error) {
      return send(res, error.httpStatus || 400, { error: error.message || "Не удалось создать товар" });
    }
  }

  const productMatch = url.pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (productMatch) {
    const productId = decodeURIComponent(productMatch[1]);
    const productIndex = store.products.findIndex((product) => product.id === productId);
    if (productIndex === -1) return notFound(res);
    if (req.method === "PUT") {
      try {
        const payload = await readJson(req);
        const before = { ...store.products[productIndex] };
        if (!hasPermission(adminUser, "products.edit")) {
          if (!hasPermission(adminUser, "products.availability")) return forbid(res);
          const allowedKeys = new Set(["isAvailable"]);
          if (Object.keys(payload).some((key) => !allowedKeys.has(key))) return send(res, 403, { error: "Доступно только изменение наличия" });
        }
        if (Number(payload.price ?? before.price) !== Number(before.price) && !hasPermission(adminUser, "products.price_edit")) {
          return send(res, 403, { error: "Недостаточно прав для изменения цены" });
        }
        const next = sanitizeProduct({ ...before, ...payload }, before);
        if (!store.categories.some((category) => category.id === next.categoryId)) return send(res, 400, { error: "Выберите существующую категорию" });
        if (next.addonIds.some((id) => !store.addons.some((addon) => addon.id === id))) return send(res, 400, { error: "Выбрано несуществующее дополнение" });
        if (next.modifierGroupIds.some((id) => !store.modifierGroups.some((group) => group.id === id))) return send(res, 400, { error: "Выбрана несуществующая группа модификаторов" });
        store.products[productIndex] = next;
        const changes = describeChanges(before, next, ["name", "description", "price", "unit", "categoryId", "imageUrl", "images", "isActive", "isAvailable", "isFeatured", "options", "addonIds", "modifierGroupIds", "freeOnionEnabled"]);
        await notifyAudit(store, adminUser, "products", "Изменён товар", next.name, changes);
        await writeStore(store);
        return send(res, 200, { product: next });
      } catch (error) {
        return send(res, error.httpStatus || 400, { error: error.message || "Не удалось изменить товар" });
      }
    }
    if (req.method === "DELETE") {
      if (!ensurePermission(adminUser, res, "products.edit")) return;
      const removed = store.products.splice(productIndex, 1)[0];
      await notifyAudit(store, adminUser, "products", "Удалён товар", removed.name);
      await writeStore(store);
      return send(res, 200, { ok: true });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/admin/modifier-groups") {
    if (!ensurePermission(adminUser, res, "products.edit")) return;
    try {
      const group = sanitizeModifierGroup(await readJson(req));
      store.modifierGroups.push(group);
      await writeStore(store);
      return send(res, 201, { group });
    } catch (error) {
      return send(res, 400, { error: error.message });
    }
  }
  const modifierGroupMatch = url.pathname.match(/^\/api\/admin\/modifier-groups\/([^/]+)$/);
  if (modifierGroupMatch) {
    if (!ensurePermission(adminUser, res, "products.edit")) return;
    const groupId = decodeURIComponent(modifierGroupMatch[1]);
    const index = store.modifierGroups.findIndex((group) => group.id === groupId);
    if (index === -1) return notFound(res);
    if (req.method === "PUT") {
      try {
        const group = sanitizeModifierGroup(await readJson(req), store.modifierGroups[index]);
        store.modifierGroups[index] = group;
        await writeStore(store);
        return send(res, 200, { group });
      } catch (error) {
        return send(res, 400, { error: error.message });
      }
    }
    if (req.method === "DELETE") {
      store.modifierGroups.splice(index, 1);
      store.products = store.products.map((product) => ({ ...product, modifierGroupIds: (product.modifierGroupIds || []).filter((id) => id !== groupId) }));
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
      description: String(payload.description || "").trim(),
      imageUrl: String(payload.imageUrl || "").trim(),
      isCustomerVisible: Boolean(payload.isCustomerVisible ?? true),
      sortOrder: Math.max(0, Number(payload.sortOrder ?? 999)),
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
        description: String(payload.description ?? before.description ?? "").trim(),
        imageUrl: String(payload.imageUrl ?? before.imageUrl ?? "").trim(),
        isCustomerVisible: Boolean(payload.isCustomerVisible ?? before.isCustomerVisible ?? true),
        sortOrder: Math.max(0, Number(payload.sortOrder ?? before.sortOrder ?? 999)),
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
      await sendOrderStatusNotification(result);
      return send(res, 200, { order: result.order, idempotent: result.idempotent });
    } catch (error) {
      return send(res, error.httpStatus || 400, { error: error.message || "Не удалось изменить статус", code: error.code });
    }
  }

  if (orderMatch && req.method === "PATCH") {
    if (!ensurePermission(adminUser, res, "orders.edit")) return;
    const orderId = decodeURIComponent(orderMatch[1]);
    const payload = await readJson(req);
    if (payload.agreedWithCustomer !== true) return send(res, 400, { error: "Подтвердите, что изменения согласованы с клиентом" });
    try {
      const result = await mutateStore(async (freshStore) => {
        const actor = freshStore.users.find((user) => user.id === adminUser.id && user.isActive);
        if (!actor || !hasPermission(actor, "orders.edit")) throw new OrderStatusError("Недостаточно прав", 403, "forbidden");
        const order = freshStore.orders.find((item) => item.id === orderId);
        if (!order) throw new OrderStatusError("Заказ не найден", 404, "not_found");
        if (!["new", "accepted", "preparing"].includes(order.status)) throw new OrderStatusError("Закрытый заказ нельзя редактировать", 409, "closed_order");
        if (payload.expectedUpdatedAt && order.updatedAt !== payload.expectedUpdatedAt) throw new OrderStatusError("Заказ уже был изменён другим сотрудником", 409, "order_conflict");

        const deliveryType = payload.deliveryType === "pickup" ? "pickup" : "delivery";
        const calculated = calculateOrder(freshStore, { items: payload.items, deliveryType });
        if (!calculated.items.length) throw new OrderStatusError("В заказе должна остаться хотя бы одна позиция");
        const customerName = String(payload.customerName || "").trim().slice(0, 80);
        const phone = normalizeRussianPhone(payload.phone);
        if (!customerName || !phone) throw new OrderStatusError("Укажите имя и корректный российский номер телефона");
        const addressData = deliveryType === "delivery" ? validateDeliveryAddress(payload.address) : null;
        const pickupPoint = deliveryType === "pickup"
          ? freshStore.pickupPoints.find((point) => point.id === String(payload.pickupPointId || "") && point.isActive)
          : null;
        if (deliveryType === "pickup" && !pickupPoint) throw new OrderStatusError("Выберите доступную точку самовывоза");

        const before = structuredClone(order);
        Object.assign(order, {
          customerName,
          phone,
          deliveryType,
          fulfillmentType: deliveryType,
          address: addressData?.formattedAddress || "",
          addressData,
          apartment: String(payload.apartment || "").trim().slice(0, 20),
          entrance: String(payload.entrance || "").trim().slice(0, 20),
          floor: String(payload.floor || "").trim().slice(0, 20),
          intercom: String(payload.intercom || "").trim().slice(0, 40),
          pickupPointId: pickupPoint?.id || "",
          pickupPointName: pickupPoint?.name || "",
          comment: String(payload.comment || "").trim().slice(0, 500),
          items: calculated.items,
          subtotal: calculated.subtotal,
          deliveryPrice: calculated.deliveryPrice,
          total: calculated.total,
          updatedAt: new Date().toISOString()
        });
        const changes = describeChanges(before, order, ["customerName", "phone", "deliveryType", "address", "pickupPointName", "comment", "items", "subtotal", "deliveryPrice", "total"]);
        order.changeLog.unshift({ id: crypto.randomUUID(), changedAt: order.updatedAt, changedByUserId: actor.id, changedBy: auditActor(actor), agreedWithCustomer: true, changes });
        await notifyAudit(freshStore, actor, "orders", "Согласованно изменён заказ", `#${order.orderNumber}`, changes);
        return { order, store: freshStore };
      });
      await refreshOrderTelegram(result.order);
      return send(res, 200, { order: { ...result.order, availableTransitions: availableOrderTransitions(result.order) } });
    } catch (error) {
      return send(res, error.httpStatus || 400, { error: error.message || "Не удалось изменить заказ", code: error.code });
    }
  }

  if (orderMatch && req.method === "DELETE") {
    if (!ensurePermission(adminUser, res, "orders.archive")) return;
    const orderId = decodeURIComponent(orderMatch[1]);
    try {
      const result = await mutateStore(async (freshStore) => {
        const actor = freshStore.users.find((user) => user.id === adminUser.id && user.isActive);
        if (!actor || !hasPermission(actor, "orders.archive")) throw new OrderStatusError("Недостаточно прав", 403, "forbidden");
        const order = freshStore.orders.find((item) => item.id === orderId);
        if (!order) throw new OrderStatusError("Заказ не найден", 404, "not_found");
        if (!["completed", "cancelled"].includes(order.status)) throw new OrderStatusError("Активный заказ нельзя архивировать", 409, "active_order");
        if (order.archivedAt) return { order, changed: false };
        order.archivedAt = new Date().toISOString();
        order.archivedByUserId = actor.id;
        order.updatedAt = order.archivedAt;
        await notifyAudit(freshStore, actor, "orders", "Заказ архивирован", `#${order.orderNumber}`);
        return { order };
      });
      return send(res, 200, { order: result.order });
    } catch (error) {
      return send(res, error.httpStatus || 400, { error: error.message || "Не удалось архивировать заказ", code: error.code });
    }
  }

  const restoreOrderMatch = url.pathname.match(/^\/api\/admin\/orders\/([^/]+)\/restore$/);
  if (restoreOrderMatch && req.method === "POST") {
    if (!ensurePermission(adminUser, res, "orders.archive")) return;
    const orderId = decodeURIComponent(restoreOrderMatch[1]);
    try {
      const result = await mutateStore(async (freshStore) => {
        const actor = freshStore.users.find((user) => user.id === adminUser.id && user.isActive);
        if (!actor || !hasPermission(actor, "orders.archive")) throw new OrderStatusError("Недостаточно прав", 403, "forbidden");
        const order = freshStore.orders.find((item) => item.id === orderId);
        if (!order) throw new OrderStatusError("Заказ не найден", 404, "not_found");
        order.archivedAt = "";
        order.archivedByUserId = "";
        order.updatedAt = new Date().toISOString();
        await notifyAudit(freshStore, actor, "orders", "Заказ восстановлен из архива", `#${order.orderNumber}`);
        return { order };
      });
      return send(res, 200, { order: result.order });
    } catch (error) {
      return send(res, error.httpStatus || 400, { error: error.message || "Не удалось восстановить заказ", code: error.code });
    }
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/settings") {
    if (!ensurePermission(adminUser, res, "settings.manage")) return;
    const payload = await readJson(req);
    const urlFields = ["maxUrl", "instagramUrl"];
    for (const field of urlFields) {
      if (field in payload) payload[field] = optionalExternalUrl(payload[field], field);
    }
    store.settings = {
      ...store.settings,
      ...payload,
      deliveryPrice: Number(payload.deliveryPrice ?? store.settings.deliveryPrice),
      freeDeliveryFrom: Number(payload.freeDeliveryFrom ?? store.settings.freeDeliveryFrom),
      minOrderAmount: Number(payload.minOrderAmount ?? store.settings.minOrderAmount),
      maxOrderAmount: Number(payload.maxOrderAmount ?? store.settings.maxOrderAmount)
    };
    await writeStore(store);
    return send(res, 200, { settings: store.settings });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/telegram/group-link") {
    if (!ensurePermission(adminUser, res, "settings.manage")) return;
    const code = crypto.randomBytes(6).toString("hex").toUpperCase();
    store.telegramGroupLinks = (store.telegramGroupLinks || []).filter((link) => link.expiresAt > Date.now());
    store.telegramGroupLinks.push({ code, createdByUserId: adminUser.id, expiresAt: Date.now() + 30 * 60_000 });
    await writeStore(store);
    return send(res, 201, { code, command: `/connectgroup ${code}`, expiresInMinutes: 30 });
  }

  const telegramUserMatch = url.pathname.match(/^\/api\/admin\/telegram\/users\/([^/]+)$/);
  if (telegramUserMatch && req.method === "PUT") {
    if (!ensurePermission(adminUser, res, "settings.manage")) return;
    const user = store.users.find((item) => item.id === decodeURIComponent(telegramUserMatch[1]));
    if (!user) return notFound(res);
    const payload = await readJson(req);
    if ("isActive" in payload) user.telegramNotificationsEnabled = Boolean(payload.isActive);
    if (Array.isArray(payload.events)) {
      user.telegramEvents = [...new Set(payload.events.map(String).filter((event) => telegramEventTypes.includes(event)))];
    }
    user.updatedAt = new Date().toISOString();
    await writeStore(store);
    return send(res, 200, { user: serializeUser(user) });
  }

  const recipientMatch = url.pathname.match(/^\/api\/admin\/telegram\/recipients\/([^/]+)$/);
  if (recipientMatch && req.method === "PUT") {
    if (!ensurePermission(adminUser, res, "settings.manage")) return;
    const recipient = (store.telegramRecipients || []).find((item) => item.id === decodeURIComponent(recipientMatch[1]));
    if (!recipient) return notFound(res);
    const payload = await readJson(req);
    recipient.title = String(payload.title ?? recipient.title).trim().slice(0, 120) || recipient.title;
    recipient.isActive = Boolean(payload.isActive ?? recipient.isActive);
    recipient.events = [...new Set((Array.isArray(payload.events) ? payload.events : recipient.events || []).map(String).filter((event) => telegramEventTypes.includes(event)))];
    await writeStore(store);
    return send(res, 200, { recipient });
  }
  if (recipientMatch && req.method === "DELETE") {
    if (!ensurePermission(adminUser, res, "settings.manage")) return;
    const before = store.telegramRecipients.length;
    store.telegramRecipients = store.telegramRecipients.filter((item) => item.id !== decodeURIComponent(recipientMatch[1]));
    if (store.telegramRecipients.length === before) return notFound(res);
    await writeStore(store);
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/telegram/test") {
    if (!ensurePermission(adminUser, res, "settings.manage")) return;
    const payload = await readJson(req);
    const requestedIds = Array.isArray(payload.recipientIds) ? payload.recipientIds.map(String) : [];
    const groupChats = (store.telegramRecipients || []).filter((item) => !requestedIds.length || requestedIds.includes(item.id)).map((item) => item.chatId);
    const personalChats = store.users.filter((user) => user.isActive && user.telegramChatId && (!requestedIds.length || requestedIds.includes(`user:${user.id}`))).map((user) => user.telegramChatId);
    const delivery = await sendTelegramText([...groupChats, ...personalChats], `✅ Тестовое уведомление\nОтправил: ${userNameForAudit(adminUser)}\nВремя: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`);
    return send(res, delivery.sent ? 200 : 502, { delivery });
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
      mapUrl: optionalExternalUrl(payload.mapUrl, "Карта"),
      yandexFoodUrl: optionalExternalUrl(payload.yandexFoodUrl, "Яндекс Еда"),
      deliveryClubUrl: optionalExternalUrl(payload.deliveryClubUrl, "Delivery Club"),
      comment: String(payload.comment || ""),
      description: String(payload.description || ""),
      imageUrl: String(payload.imageUrl || ""),
      services: Array.isArray(payload.services) ? payload.services.map(String).slice(0, 12) : [],
      sortOrder: Math.max(0, Number(payload.sortOrder ?? 999)),
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
      for (const field of ["mapUrl", "yandexFoodUrl", "deliveryClubUrl"]) {
        if (field in payload) payload[field] = optionalExternalUrl(payload[field], field);
      }
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
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8"
};

async function staticFile(req, res, url) {
  const distDir = path.join(rootDir, "dist");
  const publicDir = path.join(rootDir, "public");
  const requested = decodeURIComponent(url.pathname);
  if (requested === "/sitemap.xml") {
    const origin = publicSiteOrigin || `http://${req.headers.host || `localhost:${port}`}`;
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

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const requestOrigin = String(req.headers.origin || "").replace(/\/$/, "");
    if (url.pathname.startsWith("/api/") && requestOrigin && isAllowedCorsOrigin(requestOrigin)) {
      res.setHeader("access-control-allow-origin", requestOrigin);
      res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
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
    if (isProduction && publicSiteOrigin) {
      const canonical = new URL(publicSiteOrigin);
      const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
      const incomingHost = String(forwardedHost || req.headers.host || "").split(":")[0].toLowerCase();
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
    const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    if (isProduction && forwardedProtocol === "https") {
      res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
    }
    if (req.method === "GET" && url.pathname === "/health") {
      await sendHealth(res);
      return;
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
});

let telegramPollTimer = null;

await ensureStore();

server.listen(port, "0.0.0.0", () => {
  console.log(`Shashlik Like API listening on http://0.0.0.0:${port}`);
  if (telegramPollingEnabled) {
    void pollTelegram();
    telegramPollTimer = setInterval(() => void pollTelegram(), 5000);
    telegramPollTimer.unref();
  }
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (telegramPollTimer) clearInterval(telegramPollTimer);
  console.log(`Received ${signal}; stopping HTTP server`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  server.close(async () => {
    clearTimeout(forceExit);
    if (databasePool) await databasePool.end().catch(() => undefined);
    process.exit(0);
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));





