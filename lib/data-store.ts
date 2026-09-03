import { mkdir, readFile, readdir, stat, writeFile } from "fs/promises";
import path from "path";
import { hasR2ImageStorage, listR2Keys, readR2Text, writeR2Text } from "@/lib/image-storage";

type PgPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  connect: () => Promise<{
    query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
    release: () => void;
  }>;
};

export type StoreHealthReport = {
  primaryStore: "database" | "r2" | "vercel_blob" | "local_file";
  database: {
    configured: boolean;
    ok: boolean;
    envName?: string;
    sizeBytes?: number;
    limitBytes?: number;
    usedPercent?: number;
    backupPending?: number;
    warning?: string;
    error?: string;
  };
  r2: {
    configured: boolean;
    ok: boolean;
    warning?: string;
    error?: string;
  };
  local: {
    dataDir: string;
    ok: boolean;
    sizeBytes?: number;
    error?: string;
  };
};

let poolPromise: Promise<PgPool> | null = null;
let schemaReadyPromise: Promise<void> | null = null;
const localStoreLocks = new Map<string, Promise<void>>();

const databaseEnvNames = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "STORAGE_DATABASE_URL",
  "STORAGE_POSTGRES_URL",
  "STORAGE_POSTGRES_PRISMA_URL",
  "STORAGE_POSTGRES_URL_NON_POOLING",
  "SUPABASE_DATABASE_URL",
  "NEON_DATABASE_URL"
];

export function writableDataDir() {
  if (process.env.BLANWHI_DATA_DIR) return process.env.BLANWHI_DATA_DIR;
  if (process.env.VERCEL || process.env.NODE_ENV === "production") return path.join("/tmp", "blanwhi-data");
  return path.join(process.cwd(), "data");
}

export function hasDatabase() {
  return Boolean(databaseUrl());
}

export function databaseUrl() {
  for (const name of databaseEnvNames) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
}

export function databaseEnvName() {
  return databaseEnvNames.find((name) => Boolean(process.env[name])) || "";
}

export function hasBlobStore() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

export function hasR2Store() {
  return hasR2ImageStorage();
}

function shouldUseBlobStore(filename: string) {
  return filename === "site-content.json" && hasBlobStore();
}

function shouldUseDatabaseJsonStore(filename: string) {
  // These existing admin stores remain authoritative in R2. New orders use
  // the database-only keyed order-records store, so enabling Postgres cannot
  // replace live products, merchant keys, or the legacy order archive.
  return hasDatabase() && !["site-content.json", "integrations.json", "orders.json"].includes(filename);
}

function shouldUseEncryptedBlobStore(filename: string) {
  return ["orders.json", "deleted-orders.json", "integrations.json", "pancake-logs.json", "pancake-queue.json", "pancake-links.json"].includes(filename)
    && hasBlobStore()
    && Boolean(process.env.DATA_ENCRYPTION_KEY || process.env.PANCAKE_WEBHOOK_SECRET || process.env.BLOB_READ_WRITE_TOKEN);
}

const siteContentBlobPath = "blanwhi/content/site-content.json";
const siteContentR2Path = "blanwhi/data/site-content.json";

function encryptedR2Path(filename: string) {
  return "blanwhi/data/private/" + filename.replace(/\.json$/, "") + ".enc.json";
}

function keyedR2IndexPath(namespace: string) {
  return "blanwhi/data/private-keyed-index/" + namespace + ".enc.json";
}

function keyedR2RecordPath(namespace: string, itemKey: string) {
  const encodedKey = Buffer.from(itemKey, "utf8").toString("base64url");
  return `blanwhi/data/private-keyed/${namespace}/${encodedKey}.enc.json`;
}

function databaseBackupR2RecordPath(namespace: string, itemKey: string) {
  const encodedKey = Buffer.from(itemKey, "utf8").toString("base64url");
  return `blanwhi/data/database-keyed-backup/${namespace}/${encodedKey}.enc.json`;
}

function databaseBackupR2HistoryPath(namespace: string, itemKey: string) {
  const encodedKey = Buffer.from(itemKey, "utf8").toString("base64url");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `blanwhi/data/database-keyed-backup-history/${namespace}/${encodedKey}-${timestamp}-${crypto.randomUUID()}.enc.json`;
}

function encryptedBlobPath(filename: string) {
  return `blanwhi/private/${filename.replace(/\.json$/, "")}.enc.json`;
}

function keyedBlobIndexPath(namespace: string) {
  return `blanwhi/private-keyed-index/${namespace}.enc.json`;
}

function warnBlobFallback(action: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[BLANWHI storage] ${action} failed; using the repository fallback. ${message}`);
}

async function encryptionKey() {
  const token = process.env.DATA_ENCRYPTION_KEY || process.env.PANCAKE_WEBHOOK_SECRET || process.env.BLOB_READ_WRITE_TOKEN || process.env.R2_SECRET_ACCESS_KEY;
  if (!token) throw new Error("Thiếu DATA_ENCRYPTION_KEY hoặc PANCAKE_WEBHOOK_SECRET để mã hóa dữ liệu đơn hàng.");
  const { createHash } = await import("crypto");
  return createHash("sha256").update(`blanwhi-admin-v1:${token}`).digest();
}

async function encryptJson(value: unknown) {
  const { createCipheriv, randomBytes } = await import("crypto");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: ciphertext.toString("base64")
  });
}

async function decryptJson<T>(text: string) {
  const { createDecipheriv } = await import("crypto");
  const envelope = JSON.parse(text) as { version?: number; iv?: string; tag?: string; data?: string };
  if (envelope.version !== 1 || !envelope.iv || !envelope.tag || !envelope.data) {
    throw new Error("Bản lưu dữ liệu admin không hợp lệ.");
  }
  const decipher = createDecipheriv("aes-256-gcm", await encryptionKey(), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

async function readR2JsonStore<T>() {
  const text = await readR2Text(siteContentR2Path);
  return text === null ? null : JSON.parse(text) as T;
}

async function writeR2JsonStore<T>(value: T) {
  const previous = await readR2Text(siteContentR2Path);
  if (previous !== null) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    await writeR2Text("blanwhi/data/content-history/site-content-" + timestamp + ".json", previous);
  }
  await writeR2Text(siteContentR2Path, JSON.stringify(value));
  return value;
}

async function readEncryptedR2JsonStore<T>(filename: string) {
  const text = await readR2Text(encryptedR2Path(filename));
  return text === null ? null : decryptJson<T>(text);
}

async function writeEncryptedR2JsonStore<T>(filename: string, value: T) {
  const pathname = encryptedR2Path(filename);
  const [previous, encrypted] = await Promise.all([readR2Text(pathname), encryptJson(value)]);
  const writes = [writeR2Text(pathname, encrypted)];
  if (previous !== null) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    writes.push(writeR2Text("blanwhi/data/private-history/" + toStoreKey(filename) + "-" + timestamp + ".enc.json", previous));
  }
  await Promise.all(writes);
  return value;
}

async function readEncryptedR2JsonStoreHistory<T>(filename: string, limit: number) {
  const prefix = "blanwhi/data/private-history/" + toStoreKey(filename) + "-";
  const keys = (await listR2Keys(prefix))
    .filter((key) => key.endsWith(".enc.json"))
    .sort((left, right) => right.localeCompare(left))
    .slice(0, limit);
  const values = await Promise.all(keys.map(async (key) => {
    try {
      const text = await readR2Text(key);
      return text === null ? null : await decryptJson<T>(text);
    } catch {
      return null;
    }
  }));
  return values.filter((value) => value !== null) as T[];
}

async function readKeyedR2Index<T>(namespace: string) {
  const text = await readR2Text(keyedR2IndexPath(namespace));
  return text === null ? null : decryptJson<Record<string, T>>(text);
}

async function readKeyedR2Records<T>(namespace: string) {
  const prefix = `blanwhi/data/private-keyed/${namespace}/`;
  const keys = await listR2Keys(prefix);
  if (!keys.length) return null;
  const entries: Array<readonly [string, T] | null> = [];
  const concurrency = 12;
  for (let index = 0; index < keys.length; index += concurrency) {
    const batch = await Promise.all(keys.slice(index, index + concurrency).map(async (key) => {
      try {
        const text = await readR2Text(key);
        if (text === null) return null;
        const encodedKey = key.slice(prefix.length).replace(/\.enc\.json$/, "");
        const itemKey = Buffer.from(encodedKey, "base64url").toString("utf8");
        return [itemKey, await decryptJson<T>(text)] as const;
      } catch {
        return null;
      }
    }));
    entries.push(...batch);
  }
  return Object.fromEntries(entries.filter((entry) => entry !== null)) as Record<string, T>;
}

async function readDatabaseKeyedBackupR2Records<T>(namespace: string) {
  if (!hasR2Store()) return {};
  const prefix = `blanwhi/data/database-keyed-backup/${namespace}/`;
  const keys = await listR2Keys(prefix);
  const entries: Array<readonly [string, T] | null> = [];
  const concurrency = 12;
  for (let index = 0; index < keys.length; index += concurrency) {
    const batch = await Promise.all(keys.slice(index, index + concurrency).map(async (key) => {
      try {
        const text = await readR2Text(key);
        if (text === null) return null;
        const encodedKey = key.slice(prefix.length).replace(/\.enc\.json$/, "");
        return [Buffer.from(encodedKey, "base64url").toString("utf8"), await decryptJson<T>(text)] as const;
      } catch {
        return null;
      }
    }));
    entries.push(...batch);
  }
  return Object.fromEntries(entries.filter((entry) => entry !== null)) as Record<string, T>;
}

async function writeKeyedR2Index<T>(namespace: string, value: Record<string, T>) {
  await writeR2Text(keyedR2IndexPath(namespace), await encryptJson(value));
}

async function writeKeyedR2Record<T>(namespace: string, itemKey: string, value: T) {
  await writeR2Text(keyedR2RecordPath(namespace, itemKey), await encryptJson(value));
}

async function mirrorDatabaseKeyedRecordToR2<T>(namespace: string, itemKey: string, value: T) {
  if (!hasR2Store()) return;
  try {
    const encrypted = await encryptJson(value);
    await Promise.all([
      writeR2Text(databaseBackupR2RecordPath(namespace, itemKey), encrypted),
      writeR2Text(databaseBackupR2HistoryPath(namespace, itemKey), encrypted)
    ]);
    const pool = await getPool();
    if (pool) {
      await pool.query("delete from blanwhi_backup_outbox where namespace = $1 and item_key = $2", [namespace, itemKey]);
    }
  } catch (error) {
    warnBlobFallback("mirror database keyed record to R2 " + namespace, error);
    const pool = await getPool().catch(() => null);
    if (pool) {
      await pool.query(
        `update blanwhi_backup_outbox
         set attempts = attempts + 1, last_error = $3, updated_at = now()
         where namespace = $1 and item_key = $2`,
        [namespace, itemKey, error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000)]
      ).catch(() => undefined);
    }
  }
}

async function flushDatabaseBackupOutbox(limit = 100) {
  if (!hasDatabase() || !hasR2Store()) return 0;
  await ensureDatabaseSchema();
  const pool = await getPool();
  if (!pool) return 0;
  const result = await pool.query(
    `select namespace, item_key, item_value
     from blanwhi_backup_outbox
     order by updated_at asc
     limit $1`,
    [Math.max(1, Math.min(500, Math.floor(limit)))]
  );
  for (const row of result.rows) {
    await mirrorDatabaseKeyedRecordToR2(String(row.namespace), String(row.item_key), row.item_value);
  }
  const pending = await pool.query("select count(*)::int as count from blanwhi_backup_outbox");
  return Number(pending.rows[0]?.count || 0);
}

async function readEncryptedBlobJsonStore<T>(filename: string) {
  const { get } = await import("@vercel/blob");
  const result = await get(encryptedBlobPath(filename), { access: "public", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return decryptJson<T>(await new Response(result.stream).text());
}

async function readKeyedBlobIndex<T>(namespace: string) {
  const { get } = await import("@vercel/blob");
  const result = await get(keyedBlobIndexPath(namespace), { access: "public", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return decryptJson<Record<string, T>>(await new Response(result.stream).text());
}

async function writeKeyedBlobIndex<T>(namespace: string, value: Record<string, T>) {
  const { put } = await import("@vercel/blob");
  await put(keyedBlobIndexPath(namespace), await encryptJson(value), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json"
  });
}

async function writeEncryptedBlobJsonStore<T>(filename: string, value: T) {
  const { get, put } = await import("@vercel/blob");
  const pathname = encryptedBlobPath(filename);
  const [previous, encrypted] = await Promise.all([
    get(pathname, { access: "public", useCache: false }),
    encryptJson(value)
  ]);
  const writes = [put(pathname, encrypted, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json"
  })];
  if (previous?.statusCode === 200) {
    const previousText = await new Response(previous.stream).text();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    writes.push(put(`blanwhi/private-history/${toStoreKey(filename)}-${timestamp}.enc.json`, previousText, {
      access: "public",
      addRandomSuffix: true,
      contentType: "application/json"
    }));
  }
  await Promise.all(writes);
  return value;
}

async function readBlobJsonStore<T>() {
  const { get } = await import("@vercel/blob");
  const result = await get(siteContentBlobPath, { access: "public", useCache: false });
  if (!result || result.statusCode !== 200) return null;

  const text = await new Response(result.stream).text();
  return JSON.parse(text) as T;
}

async function writeBlobJsonStore<T>(value: T) {
  const { get, put } = await import("@vercel/blob");

  const previous = await get(siteContentBlobPath, { access: "public", useCache: false });
  if (previous?.statusCode === 200) {
    const previousText = await new Response(previous.stream).text();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    await put(`blanwhi/content-history/site-content-${timestamp}.json`, previousText, {
      access: "public",
      addRandomSuffix: true,
      contentType: "application/json"
    });
  }

  await put(siteContentBlobPath, JSON.stringify(value), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json"
  });
  return value;
}

async function getPool() {
  const url = databaseUrl();
  if (!url) return null;
  if (!poolPromise) {
    poolPromise = import("pg").then(({ Pool }) => {
      const isLocal = /localhost|127\.0\.0\.1/.test(url);
      return new Pool({
        connectionString: url,
        ssl: process.env.PGSSLMODE === "disable" || isLocal ? false : { rejectUnauthorized: false }
      }) as PgPool;
    });
  }
  return poolPromise;
}

export async function withDataStoreLock<T>(name: string, action: () => Promise<T>): Promise<T> {
  const lockName = `blanwhi:${String(name || "default").slice(0, 120)}`;
  if (hasDatabase()) {
    await ensureDatabaseSchema();
    const pool = await getPool();
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query("select pg_advisory_lock(hashtext($1))", [lockName]);
        return await action();
      } finally {
        try {
          await client.query("select pg_advisory_unlock(hashtext($1))", [lockName]);
        } finally {
          client.release();
        }
      }
    }
  }

  const previous = localStoreLocks.get(lockName) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  localStoreLocks.set(lockName, queued);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (localStoreLocks.get(lockName) === queued) localStoreLocks.delete(lockName);
  }
}

async function ensureDatabaseSchema() {
  const pool = await getPool();
  if (!pool) return;
  if (!schemaReadyPromise) {
    const schemaRequest = (async () => {
      await pool.query(`
        create table if not exists blanwhi_store (
          store_key text primary key,
          store_value jsonb not null,
          updated_at timestamptz not null default now()
        )
      `);
      await pool.query(`
        create table if not exists blanwhi_store_history (
          id bigserial primary key,
          store_key text not null,
          store_value jsonb not null,
          reason text not null default 'before-write',
          created_at timestamptz not null default now()
        )
      `);
      await pool.query(`
        create index if not exists blanwhi_store_history_key_created_idx
        on blanwhi_store_history (store_key, created_at desc)
      `);
      await pool.query(`
        create table if not exists blanwhi_keyed_store (
          namespace text not null,
          item_key text not null,
          item_value jsonb not null,
          updated_at timestamptz not null default now(),
          primary key (namespace, item_key)
        )
      `);
      await pool.query(`
        create table if not exists blanwhi_keyed_store_history (
          id bigserial primary key,
          namespace text not null,
          item_key text not null,
          item_value jsonb not null,
          reason text not null default 'before-write',
          created_at timestamptz not null default now()
        )
      `);
      await pool.query(`
        create index if not exists blanwhi_keyed_store_history_lookup_idx
        on blanwhi_keyed_store_history (namespace, item_key, created_at desc)
      `);
      await pool.query(`
        create table if not exists blanwhi_backup_outbox (
          namespace text not null,
          item_key text not null,
          item_value jsonb not null,
          attempts integer not null default 0,
          last_error text,
          updated_at timestamptz not null default now(),
          primary key (namespace, item_key)
        )
      `);
    })();
    schemaReadyPromise = schemaRequest.catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  await schemaReadyPromise;
}

function toStoreKey(filename: string) {
  return filename.replace(/\.json$/, "");
}

async function directorySize(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += await directorySize(fullPath);
        return;
      }
      if (entry.isFile()) total += (await stat(fullPath)).size;
    }));
  } catch {
    return total;
  }
  return total;
}

function isStorageLimitError(error: unknown) {
  const candidate = error as { code?: string; message?: string; detail?: string };
  const text = `${candidate.code || ""} ${candidate.message || ""} ${candidate.detail || ""}`.toLowerCase();
  return (
    candidate.code === "53100" ||
    candidate.code === "53200" ||
    text.includes("enospc") ||
    text.includes("no space") ||
    text.includes("disk full") ||
    text.includes("quota") ||
    text.includes("storage limit") ||
    text.includes("storage exceeded")
  );
}

function throwStoreWriteError(error: unknown): never {
  if (isStorageLimitError(error)) {
    throw new Error("Dung lượng lưu trữ đã đầy. Hệ thống chưa xoá dữ liệu cũ và chưa ghi đè bản mới. Vui lòng xoá bớt dữ liệu/ảnh không dùng hoặc nâng cấp dung lượng rồi lưu lại.");
  }
  throw error;
}

async function backupJsonFile<T>(file: string, key: string) {
  try {
    const previous = await readFile(file, "utf8");
    const backupDir = path.join(path.dirname(file), "backups", key);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    await mkdir(backupDir, { recursive: true });
    await writeFile(path.join(backupDir, `${timestamp}.json`), previous, "utf8");
  } catch {
    // If the first write has no previous file, there is nothing to back up.
  }
}

export async function createJsonStoreBackup<T>(filename: string, value: T, reason = "manual-backup") {
  const key = toStoreKey(filename);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  if (hasDatabase()) {
    await ensureDatabaseSchema();
    const pool = await getPool();
    if (pool) {
      await pool.query(
        `insert into blanwhi_store_history (store_key, store_value, reason, created_at)
         values ($1, $2::jsonb, $3, now())`,
        [key, JSON.stringify(value), reason]
      );
      return { location: "database", key, createdAt: new Date().toISOString() };
    }
  }

  if (hasR2Store()) {
    const isPrivate = ["orders.json", "deleted-orders.json", "integrations.json", "pancake-logs.json", "pancake-queue.json", "pancake-links.json"].includes(filename);
    const pathname = isPrivate
      ? `blanwhi/data/manual-backups/private/${key}-${timestamp}.enc.json`
      : `blanwhi/data/manual-backups/${key}-${timestamp}.json`;
    await writeR2Text(pathname, isPrivate ? await encryptJson(value) : JSON.stringify(value), "application/json");
    return { location: "r2", key: pathname, createdAt: new Date().toISOString() };
  }

  if (hasBlobStore()) {
    const { put } = await import("@vercel/blob");
    const isPrivate = ["orders.json", "deleted-orders.json", "integrations.json", "pancake-logs.json", "pancake-queue.json", "pancake-links.json"].includes(filename);
    const pathname = isPrivate
      ? `blanwhi/manual-backups/private/${key}-${timestamp}.enc.json`
      : `blanwhi/manual-backups/${key}-${timestamp}.json`;
    await put(pathname, isPrivate ? await encryptJson(value) : JSON.stringify(value), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json"
    });
    return { location: "vercel_blob", key: pathname, createdAt: new Date().toISOString() };
  }

  const dir = path.join(writableDataDir(), "manual-backups", key);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${timestamp}.json`);
  await writeFile(file, JSON.stringify(value, null, 2), "utf8");
  return { location: "local_file", key: file, createdAt: new Date().toISOString() };
}

export async function getStoreHealthReport(): Promise<StoreHealthReport> {
  const primaryStore: StoreHealthReport["primaryStore"] = hasDatabase()
    ? "database"
    : hasR2Store()
      ? "r2"
      : hasBlobStore()
        ? "vercel_blob"
        : "local_file";
  const report: StoreHealthReport = {
    primaryStore,
    database: {
      configured: hasDatabase(),
      ok: false,
      envName: databaseEnvName() || undefined
    },
    r2: { configured: false, ok: false },
    local: { dataDir: writableDataDir(), ok: false }
  };

  if (hasDatabase()) {
    try {
      await ensureDatabaseSchema();
      const pool = await getPool();
      if (pool) {
        const [ping, size] = await Promise.all([
          pool.query("select 1 as ok"),
          pool.query("select pg_database_size(current_database()) as size_bytes").catch(() => ({ rows: [] }))
        ]);
        report.database.ok = Number(ping.rows[0]?.ok) === 1;
        report.database.backupPending = await flushDatabaseBackupOutbox(100);
        const rawSize = size.rows[0]?.size_bytes;
        const sizeBytes = typeof rawSize === "bigint" ? Number(rawSize) : Number(rawSize || 0);
        if (Number.isFinite(sizeBytes) && sizeBytes > 0) report.database.sizeBytes = sizeBytes;
        const limitMb = Number(process.env.DATABASE_STORAGE_LIMIT_MB || 0);
        if (limitMb > 0) {
          report.database.limitBytes = limitMb * 1024 * 1024;
          report.database.usedPercent = Math.round((sizeBytes / report.database.limitBytes) * 1000) / 10;
          if (report.database.usedPercent >= 80) report.database.warning = "Database sắp đầy. Nên nâng cấp dung lượng hoặc dọn dữ liệu không cần thiết.";
        } else {
          report.database.warning = "Chưa cấu hình DATABASE_STORAGE_LIMIT_MB nên chưa tính được cảnh báo sắp đầy chính xác.";
        }
      }
    } catch (error) {
      report.database.error = error instanceof Error ? error.message : String(error);
    }
  } else {
    report.database.warning = hasR2Store()
      ? "Đơn hàng đang được lưu bền vững trong Cloudflare R2 mã hóa; database URL hiện là tùy chọn."
      : "Chưa có database URL. Production nên dùng database thật để đơn hàng không phụ thuộc server tạm.";
  }

  try {
    report.r2.configured = hasR2Store();
    if (report.r2.configured) {
      await writeR2Text("blanwhi/health/last-check.json", JSON.stringify({ checkedAt: new Date().toISOString() }));
      report.r2.ok = true;
      report.r2.warning = "R2 đang kết nối được. Muốn báo sắp hết dung lượng chính xác cần thêm Cloudflare API token có quyền đọc usage/quota.";
    } else {
      report.r2.warning = "Chưa cấu hình R2. Ảnh production nên lưu ở R2 hoặc kho object storage tương đương.";
    }
  } catch (error) {
    report.r2.error = error instanceof Error ? error.message : String(error);
  }

  try {
    await mkdir(writableDataDir(), { recursive: true });
    report.local.sizeBytes = await directorySize(writableDataDir());
    report.local.ok = true;
  } catch (error) {
    report.local.error = error instanceof Error ? error.message : String(error);
  }

  return report;
}

export async function ensureJsonFile<T>(filename: string, fallback: T) {
  const dir = writableDataDir();
  const file = path.join(dir, filename);
  await mkdir(dir, { recursive: true });
  try {
    await readFile(file, "utf8");
  } catch {
    let seed = fallback;
    try {
      seed = JSON.parse(await readFile(path.join(process.cwd(), "data", filename), "utf8")) as T;
    } catch {
      seed = fallback;
    }
    await writeFile(file, JSON.stringify(seed, null, 2), "utf8");
  }
  return file;
}

async function readJsonStoreUncached<T>(filename: string, fallback: T): Promise<T> {
  if (shouldUseDatabaseJsonStore(filename)) {
    try {
      await ensureDatabaseSchema();
      const pool = await getPool();
      if (pool) {
        const key = toStoreKey(filename);
        const result = await pool.query("select store_value from blanwhi_store where store_key = $1", [key]);
        if (result.rows[0]?.store_value !== undefined) return result.rows[0].store_value as T;

        const file = await ensureJsonFile<T>(filename, fallback);
        let seed = fallback;
        try {
          seed = JSON.parse(await readFile(file, "utf8")) as T;
        } catch {
          seed = fallback;
        }
        await writeJsonStore(filename, seed);
        return seed;
      }
    } catch (error) {
      warnBlobFallback(`read database ${filename}`, error);
    }
  }

  if (hasR2Store() && filename === "site-content.json") {
    try {
      const saved = await readR2JsonStore<T>();
      if (saved !== null) return saved;
    } catch (error) {
      warnBlobFallback("read R2 " + filename, error);
    }
  }

  if (hasR2Store() && ["orders.json", "deleted-orders.json", "integrations.json", "pancake-logs.json", "pancake-queue.json", "pancake-links.json"].includes(filename)) {
    try {
      const saved = await readEncryptedR2JsonStore<T>(filename);
      if (saved !== null) return saved;
    } catch (error) {
      warnBlobFallback("read encrypted R2 " + filename, error);
    }
  }

  if (shouldUseBlobStore(filename)) {
    try {
      const saved = await readBlobJsonStore<T>();
      if (saved !== null) return saved;
    } catch (error) {
      warnBlobFallback(`read ${filename}`, error);
    }
  }

  if (shouldUseEncryptedBlobStore(filename)) {
    try {
      const saved = await readEncryptedBlobJsonStore<T>(filename);
      if (saved !== null) return saved;
    } catch (error) {
      warnBlobFallback(`read ${filename}`, error);
    }
  }

  const file = await ensureJsonFile<T>(filename, fallback);
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

const jsonStoreReadRequests = new Map<string, Promise<unknown>>();

export async function readJsonStore<T>(filename: string, fallback: T): Promise<T> {
  const current = jsonStoreReadRequests.get(filename) as Promise<T> | undefined;
  if (current) return current;

  const request = readJsonStoreUncached(filename, fallback);
  jsonStoreReadRequests.set(filename, request);
  try {
    return await request;
  } finally {
    if (jsonStoreReadRequests.get(filename) === request) jsonStoreReadRequests.delete(filename);
  }
}

export async function readJsonStoreFallbackStores<T>(filename: string, fallback: T): Promise<T> {
  if (hasR2Store() && filename === "site-content.json") {
    try {
      const saved = await readR2JsonStore<T>();
      if (saved !== null) return saved;
    } catch (error) {
      warnBlobFallback("read R2 fallback " + filename, error);
    }
  }

  if (hasR2Store() && ["orders.json", "deleted-orders.json", "integrations.json", "pancake-logs.json", "pancake-queue.json", "pancake-links.json"].includes(filename)) {
    try {
      const saved = await readEncryptedR2JsonStore<T>(filename);
      if (saved !== null) return saved;
    } catch (error) {
      warnBlobFallback("read encrypted R2 fallback " + filename, error);
    }
  }

  if (shouldUseBlobStore(filename)) {
    try {
      const saved = await readBlobJsonStore<T>();
      if (saved !== null) return saved;
    } catch (error) {
      warnBlobFallback("read Blob fallback " + filename, error);
    }
  }

  if (shouldUseEncryptedBlobStore(filename)) {
    try {
      const saved = await readEncryptedBlobJsonStore<T>(filename);
      if (saved !== null) return saved;
    } catch (error) {
      warnBlobFallback("read encrypted Blob fallback " + filename, error);
    }
  }

  const file = await ensureJsonFile<T>(filename, fallback);
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function readKeyedJsonStoreDatabaseStatus<T>(namespace: string): Promise<{ ok: boolean; records: Record<string, T> }> {
  if (!hasDatabase()) return { ok: false, records: {} };
  try {
    await ensureDatabaseSchema();
    const pool = await getPool();
    if (!pool) return { ok: false, records: {} };
    const result = await pool.query(
      "select item_key, item_value from blanwhi_keyed_store where namespace = $1",
      [namespace]
    );
    return {
      ok: true,
      records: Object.fromEntries(result.rows.map((row) => [String(row.item_key), row.item_value as T])) as Record<string, T>
    };
  } catch (error) {
    warnBlobFallback(`read database keyed store ${namespace}`, error);
    return { ok: false, records: {} };
  }
}

export async function readKeyedJsonStoreDatabase<T>(namespace: string) {
  return (await readKeyedJsonStoreDatabaseStatus<T>(namespace)).records;
}

export async function readKeyedJsonStoreDatabaseBackups<T>(namespace: string) {
  try {
    return await readDatabaseKeyedBackupR2Records<T>(namespace);
  } catch (error) {
    warnBlobFallback(`read database keyed backup ${namespace}`, error);
    return {};
  }
}

export async function readKeyedJsonStoreFallbackStores<T>(namespace: string, fallback: Record<string, T> = {}) {
  if (hasR2Store()) {
    try {
      const [indexed, legacy] = await Promise.all([
        readKeyedR2Index<T>(namespace),
        readJsonStoreFallbackStores<Record<string, T>>(namespace + ".json", fallback)
      ]);
      if (indexed) return { ...legacy, ...indexed };
      const records = await readKeyedR2Records<T>(namespace);
      if (records) return { ...legacy, ...records };
      if (Object.keys(legacy).length) return legacy;
    } catch (error) {
      warnBlobFallback("read R2 keyed fallback store " + namespace, error);
    }
  }

  if (hasBlobStore()) {
    try {
      const indexed = await readKeyedBlobIndex<T>(namespace);
      const legacy = await readJsonStoreFallbackStores<Record<string, T>>(namespace + ".json", fallback);
      if (indexed) return { ...legacy, ...indexed };
      if (Object.keys(legacy).length) return legacy;
    } catch (error) {
      warnBlobFallback("read Blob keyed fallback store " + namespace, error);
    }
  }

  return readJsonStoreFallbackStores<Record<string, T>>(namespace + ".json", fallback);
}

export async function readKeyedJsonStore<T>(namespace: string, fallback: Record<string, T> = {}) {
  if (hasDatabase()) {
    const [result, legacy] = await Promise.all([
      readKeyedJsonStoreDatabase<T>(namespace),
      readKeyedJsonStoreFallbackStores<T>(namespace, fallback)
    ]);
    return { ...legacy, ...result };
  }
  if (hasR2Store()) {
    try {
      const [indexed, records] = await Promise.all([
        readKeyedR2Index<T>(namespace),
        readKeyedR2Records<T>(namespace)
      ]);
      if (indexed || records) {
        const legacy = await readJsonStore<Record<string, T>>(namespace + ".json", fallback);
        return { ...legacy, ...(indexed || {}), ...(records || {}) };
      }
    } catch (error) {
      warnBlobFallback("read R2 keyed store " + namespace, error);
    }
  }
  if (hasBlobStore()) {
    try {
      const indexed = await readKeyedBlobIndex<T>(namespace);
      if (indexed) {
        const legacy = await readJsonStore<Record<string, T>>(`${namespace}.json`, fallback);
        return { ...legacy, ...indexed };
      }

      // One-time migration for stores created before the compact index existed.
      // Avoid Blob.list() on every request because it consumes the limited
      // advanced-operations quota and can suspend the whole store.
      const { get, list } = await import("@vercel/blob");
      const prefix = `blanwhi/private-keyed/${namespace}/`;
      const result = await list({ prefix, limit: 1000 });
      if (result.blobs.length) {
        const entries = await Promise.all(result.blobs.map(async (blob) => {
          try {
            const saved = await get(blob.pathname, { access: "public", useCache: false });
            if (!saved || saved.statusCode !== 200) return null;
            const encodedKey = blob.pathname.slice(prefix.length).replace(/\.enc\.json$/, "");
            const key = Buffer.from(encodedKey, "base64url").toString("utf8");
            return [key, await decryptJson<T>(await new Response(saved.stream).text())] as const;
          } catch {
            return null;
          }
        }));
        const legacy = await readJsonStore<Record<string, T>>(`${namespace}.json`, fallback);
        const merged = { ...legacy, ...Object.fromEntries(entries.filter((entry) => entry !== null)) };
        await writeKeyedBlobIndex(namespace, merged);
        return merged;
      }
    } catch (error) {
      warnBlobFallback(`read keyed store ${namespace}`, error);
    }
  }
  return readJsonStore<Record<string, T>>(`${namespace}.json`, fallback);
}

export async function writeKeyedJsonRecord<T>(namespace: string, itemKey: string, value: T) {
  if (hasDatabase()) {
    await ensureDatabaseSchema();
    const pool = await getPool();
    if (pool) {
      await pool.query(
        `with incoming as (
           select $1::text as namespace, $2::text as item_key, $3::jsonb as item_value
         ),
         previous as (
           select current.namespace, current.item_key, current.item_value
           from blanwhi_keyed_store current
           join incoming on incoming.namespace = current.namespace and incoming.item_key = current.item_key
           where current.item_value is distinct from incoming.item_value
         ),
         backup as (
           insert into blanwhi_keyed_store_history (namespace, item_key, item_value, reason)
           select namespace, item_key, item_value, 'before-write'
           from previous
           returning id
         )
         saved as (
           insert into blanwhi_keyed_store (namespace, item_key, item_value, updated_at)
           select namespace, item_key, item_value, now()
           from incoming
           on conflict (namespace, item_key)
           do update set item_value = excluded.item_value, updated_at = now()
           returning namespace, item_key, item_value
         ),
         queued as (
           insert into blanwhi_backup_outbox (namespace, item_key, item_value, attempts, last_error, updated_at)
           select namespace, item_key, item_value, 0, null, now()
           from saved
           on conflict (namespace, item_key)
           do update set item_value = excluded.item_value, attempts = 0, last_error = null, updated_at = now()
           returning item_key
         )
         insert into blanwhi_keyed_store_history (namespace, item_key, item_value, reason)
         select namespace, item_key, item_value, 'after-write'
         from saved`,
        [namespace, itemKey, JSON.stringify(value)]
      );
      await mirrorDatabaseKeyedRecordToR2(namespace, itemKey, value);
      return value;
    }
  }
  return withDataStoreLock(`keyed-store:${namespace}`, async () => {
    if (hasR2Store()) {
      const indexed = await readKeyedR2Index<T>(namespace) || {};
      await Promise.all([
        writeKeyedR2Record(namespace, itemKey, value),
        writeKeyedR2Index(namespace, { ...indexed, [itemKey]: value })
      ]);
      return value;
    }
    if (hasBlobStore()) {
      const { put } = await import("@vercel/blob");
      const encodedKey = Buffer.from(itemKey, "utf8").toString("base64url");
      await put(`blanwhi/private-keyed/${namespace}/${encodedKey}.enc.json`, await encryptJson(value), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
        contentType: "application/json"
      });
      const indexed = await readKeyedBlobIndex<T>(namespace) || {};
      await writeKeyedBlobIndex(namespace, { ...indexed, [itemKey]: value });
      return value;
    }
    const current = await readJsonStore<Record<string, T>>(`${namespace}.json`, {});
    await writeJsonStore(`${namespace}.json`, { ...current, [itemKey]: value });
    return value;
  });
}

export async function readKeyedJsonStoreHistory<T>(namespace: string, itemKey?: string, limit = 250): Promise<T[]> {
  if (!hasDatabase()) return [];
  await ensureDatabaseSchema();
  const pool = await getPool();
  if (!pool) return [];
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  const result = itemKey
    ? await pool.query(
      `select item_value
       from blanwhi_keyed_store_history
       where namespace = $1 and item_key = $2
       order by created_at desc, id desc
       limit $3`,
      [namespace, itemKey, safeLimit]
    )
    : await pool.query(
      `select item_value
       from blanwhi_keyed_store_history
       where namespace = $1
       order by created_at desc, id desc
       limit $2`,
      [namespace, safeLimit]
    );
  return result.rows
    .map((row) => row.item_value as T)
    .filter((value): value is T => value !== undefined && value !== null);
}

export async function writeKeyedJsonRecords<T>(namespace: string, values: Record<string, T>) {
  const entries = Object.entries(values).filter(([key]) => Boolean(key));
  if (!entries.length) return values;

  if (hasDatabase()) {
    await Promise.all(entries.map(([itemKey, value]) => writeKeyedJsonRecord(namespace, itemKey, value)));
    return values;
  }

  if (hasR2Store()) {
    const indexed = await readKeyedR2Index<T>(namespace) || {};
    await Promise.all([
      ...entries.map(([itemKey, value]) => writeKeyedR2Record(namespace, itemKey, value)),
      writeKeyedR2Index(namespace, { ...indexed, ...Object.fromEntries(entries) })
    ]);
    return values;
  }

  if (hasBlobStore()) {
    await Promise.all(entries.map(([itemKey, value]) => writeKeyedJsonRecord(namespace, itemKey, value)));
    return values;
  }

  const current = await readJsonStore<Record<string, T>>(`${namespace}.json`, {});
  await writeJsonStore(`${namespace}.json`, { ...current, ...Object.fromEntries(entries) });
  return values;
}

export async function readJsonStoreHistory<T>(filename: string, limit = 100): Promise<T[]> {
  const safeLimit = Math.max(1, Math.min(250, Math.floor(limit)));
  const history: T[] = [];

  if (hasDatabase()) {
    await ensureDatabaseSchema();
    const pool = await getPool();
    if (pool) {
      const result = await pool.query(
        `select store_value
         from blanwhi_store_history
         where store_key = $1
         order by created_at desc
         limit $2`,
        [toStoreKey(filename), safeLimit]
      );
      history.push(...result.rows
        .map((row) => row.store_value as T)
        .filter((value): value is T => value !== undefined && value !== null));
    }
  }

  if (shouldUseBlobStore(filename)) {
    const { get, list } = await import("@vercel/blob");
    const result = await list({ prefix: "blanwhi/content-history/site-content-", limit: safeLimit });
    const blobs = [...result.blobs]
      .sort((left, right) => right.uploadedAt.getTime() - left.uploadedAt.getTime())
      .slice(0, safeLimit);
    const values = await Promise.all(blobs.map(async (blob) => {
      try {
        const saved = await get(blob.pathname, { access: "public", useCache: false });
        if (!saved || saved.statusCode !== 200) return null;
        return JSON.parse(await new Response(saved.stream).text()) as T;
      } catch {
        return null;
      }
    }));
    history.push(...values.filter((value) => value !== null) as T[]);
  }

  if (history.length > 0) return history;

  if (hasR2Store() && ["orders.json", "deleted-orders.json", "integrations.json", "pancake-logs.json", "pancake-queue.json", "pancake-links.json"].includes(filename)) {
    try {
      const values = await readEncryptedR2JsonStoreHistory<T>(filename, safeLimit);
      if (values.length > 0) return values;
    } catch (error) {
      warnBlobFallback("read encrypted R2 history " + filename, error);
    }
  }

  const backupDir = path.join(writableDataDir(), "backups", toStoreKey(filename));
  try {
    const files = (await readdir(backupDir))
      .filter((name) => name.endsWith(".json"))
      .sort((left, right) => right.localeCompare(left))
      .slice(0, safeLimit);
    const values = await Promise.all(files.map(async (name) => {
      try {
        return JSON.parse(await readFile(path.join(backupDir, name), "utf8")) as T;
      } catch {
        return null;
      }
    }));
    return values.filter((value) => value !== null) as T[];
  } catch {
    return [];
  }
}

export async function writeJsonStore<T>(filename: string, value: T) {
  if (shouldUseDatabaseJsonStore(filename)) {
    await ensureDatabaseSchema();
    const pool = await getPool();
    if (pool) {
      const key = toStoreKey(filename);
      try {
        await pool.query(
          `with incoming as (
             select $1::text as store_key, $2::jsonb as store_value
           ),
           previous as (
             select current.store_key, current.store_value
             from blanwhi_store current
             join incoming on incoming.store_key = current.store_key
             where current.store_value is distinct from incoming.store_value
           ),
           backup as (
             insert into blanwhi_store_history (store_key, store_value, reason)
             select store_key, store_value, 'before-write'
             from previous
             returning id
           )
           insert into blanwhi_store (store_key, store_value, updated_at)
           select store_key, store_value, now()
           from incoming
           on conflict (store_key)
           do update set store_value = excluded.store_value, updated_at = now()`,
          [key, JSON.stringify(value)]
        );
      } catch (error) {
        throwStoreWriteError(error);
      }
      return value;
    }
  }

  if (hasR2Store() && filename === "site-content.json") {
    return writeR2JsonStore(value);
  }

  if (hasR2Store() && ["orders.json", "deleted-orders.json", "integrations.json", "pancake-logs.json", "pancake-queue.json", "pancake-links.json"].includes(filename)) {
    return writeEncryptedR2JsonStore(filename, value);
  }

  if (shouldUseBlobStore(filename)) {
    return writeBlobJsonStore(value);
  }

  if (shouldUseEncryptedBlobStore(filename)) {
    return writeEncryptedBlobJsonStore(filename, value);
  }

  const file = await ensureJsonFile<T>(filename, value);
  await backupJsonFile(file, toStoreKey(filename));
  try {
    await writeFile(file, JSON.stringify(value, null, 2), "utf8");
  } catch (error) {
    throwStoreWriteError(error);
  }
  return value;
}
