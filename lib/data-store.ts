import { mkdir, readFile, writeFile } from "fs/promises";
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

function hasBlobStore() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function shouldUseBlobStore(filename: string) {
  return filename === "site-content.json" && hasBlobStore();
}

const siteContentBlobPath = "blanwhi/content/site-content.json";

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
    const saved = await readBlobJsonStore<T>();
    if (saved !== null) return saved;
  }

  const file = await ensureJsonFile<T>(filename, fallback);
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
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

  const file = await ensureJsonFile<T>(filename, value);
  await backupJsonFile(file, toStoreKey(filename));
  try {
    await writeFile(file, JSON.stringify(value, null, 2), "utf8");
  } catch (error) {
    throwStoreWriteError(error);
  }
  return value;
}
