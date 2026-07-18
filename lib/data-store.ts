import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import path from "path";

type PgPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

let poolPromise: Promise<PgPool> | null = null;
let schemaReadyPromise: Promise<void> | null = null;

export function writableDataDir() {
  if (process.env.BLANWHI_DATA_DIR) return process.env.BLANWHI_DATA_DIR;
  if (process.env.VERCEL || process.env.NODE_ENV === "production") return path.join("/tmp", "blanwhi-data");
  return path.join(process.cwd(), "data");
}

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

export function hasBlobStore() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function shouldUseBlobStore(filename: string) {
  return filename === "site-content.json" && hasBlobStore();
}

function shouldUseEncryptedBlobStore(filename: string) {
  return ["orders.json", "integrations.json", "pancake-logs.json", "pancake-queue.json", "pancake-links.json"].includes(filename)
    && hasBlobStore()
    && Boolean(process.env.DATA_ENCRYPTION_KEY || process.env.PANCAKE_WEBHOOK_SECRET || process.env.BLOB_READ_WRITE_TOKEN);
}

const siteContentBlobPath = "blanwhi/content/site-content.json";

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
  const token = process.env.DATA_ENCRYPTION_KEY || process.env.PANCAKE_WEBHOOK_SECRET || process.env.BLOB_READ_WRITE_TOKEN;
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
  const previous = await get(pathname, { access: "public", useCache: false });
  if (previous?.statusCode === 200) {
    const previousText = await new Response(previous.stream).text();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    await put(`blanwhi/private-history/${toStoreKey(filename)}-${timestamp}.enc.json`, previousText, {
      access: "public",
      addRandomSuffix: true,
      contentType: "application/json"
    });
  }
  await put(pathname, await encryptJson(value), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json"
  });
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
  if (!process.env.DATABASE_URL) return null;
  if (!poolPromise) {
    poolPromise = import("pg").then(({ Pool }) => {
      const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "");
      return new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.PGSSLMODE === "disable" || isLocal ? false : { rejectUnauthorized: false }
      }) as PgPool;
    });
  }
  return poolPromise;
}

async function ensureDatabaseSchema() {
  const pool = await getPool();
  if (!pool) return;
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
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
    })();
  }
  await schemaReadyPromise;
}

function toStoreKey(filename: string) {
  return filename.replace(/\.json$/, "");
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

export async function readJsonStore<T>(filename: string, fallback: T): Promise<T> {
  if (hasDatabase()) {
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

export async function readKeyedJsonStore<T>(namespace: string, fallback: Record<string, T> = {}) {
  if (hasDatabase()) {
    await ensureDatabaseSchema();
    const pool = await getPool();
    if (pool) {
      const result = await pool.query(
        "select item_key, item_value from blanwhi_keyed_store where namespace = $1",
        [namespace]
      );
      const legacy = await readJsonStore<Record<string, T>>(`${namespace}.json`, fallback);
      if (result.rows.length) return {
        ...legacy,
        ...Object.fromEntries(result.rows.map((row) => [String(row.item_key), row.item_value as T]))
      };
      return legacy;
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
        `insert into blanwhi_keyed_store (namespace, item_key, item_value, updated_at)
         values ($1, $2, $3::jsonb, now())
         on conflict (namespace, item_key)
         do update set item_value = excluded.item_value, updated_at = now()`,
        [namespace, itemKey, JSON.stringify(value)]
      );
      return value;
    }
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
  if (hasDatabase()) {
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
