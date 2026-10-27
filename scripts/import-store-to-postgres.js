import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";

const sourcePath = process.argv[2] ? path.resolve(process.argv[2]) : "";
const uploadsDirectory = process.argv[3] ? path.resolve(process.argv[3]) : "";
const databaseUrl = String(process.env.LAYERO_DATABASE_URL || process.env.DATABASE_URL || "").trim();

if (!sourcePath || !databaseUrl || process.env.CONFIRM_PERSISTENT_IMPORT !== "YES") {
  throw new Error("Usage: CONFIRM_PERSISTENT_IMPORT=YES LAYERO_DATABASE_URL=... node scripts/import-store-to-postgres.js /absolute/store.json [/absolute/uploads]");
}

const store = JSON.parse(await readFile(sourcePath, "utf8"));
for (const key of ["products", "orders", "users", "settings"]) {
  if (key === "settings" ? !store[key] || typeof store[key] !== "object" : !Array.isArray(store[key])) {
    throw new Error(`Backup validation failed: ${key} is missing`);
  }
}

const pool = new pg.Pool({ connectionString: databaseUrl, ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("CREATE TABLE IF NOT EXISTS app_state (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())");
  await client.query("CREATE TABLE IF NOT EXISTS app_media (id text PRIMARY KEY, content_type text NOT NULL, bytes bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())");
  const existing = await client.query("SELECT 1 FROM app_state WHERE id = 'primary'");
  if (existing.rowCount) throw new Error("Import stopped: PostgreSQL already contains app_state. No data was overwritten.");

  const mediaMap = new Map();
  const migrateMediaUrl = async (value) => {
    const url = String(value || "");
    if (!url.startsWith("/uploads/") || !uploadsDirectory) return url;
    if (mediaMap.has(url)) return mediaMap.get(url);
    const fileName = path.basename(url);
    const filePath = path.join(uploadsDirectory, fileName);
    const info = await stat(filePath);
    if (!info.isFile() || info.size > 5 * 1024 * 1024) throw new Error(`Invalid upload in backup: ${fileName}`);
    const bytes = await readFile(filePath);
    const extension = path.extname(fileName).toLowerCase();
    const contentType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
    const id = crypto.randomUUID();
    await client.query("INSERT INTO app_media (id, content_type, bytes) VALUES ($1, $2, $3)", [id, contentType, bytes]);
    const nextUrl = `/api/media/${id}`;
    mediaMap.set(url, nextUrl);
    return nextUrl;
  };

  for (const product of store.products) {
    product.imageUrl = await migrateMediaUrl(product.imageUrl);
    product.images = await Promise.all((product.images || [product.imageUrl]).map(migrateMediaUrl));
  }
  for (const point of store.pickupPoints || []) point.imageUrl = await migrateMediaUrl(point.imageUrl);
  for (const user of store.users) user.avatarUrl = await migrateMediaUrl(user.avatarUrl);
  for (const addon of store.addons || []) addon.imageUrl = await migrateMediaUrl(addon.imageUrl);

  await client.query("INSERT INTO app_state (id, data) VALUES ('primary', $1::jsonb)", [JSON.stringify(store)]);
  await client.query("COMMIT");
  console.log(JSON.stringify({ imported: true, products: store.products.length, orders: store.orders.length, users: store.users.length, media: mediaMap.size }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
