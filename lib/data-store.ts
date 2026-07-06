import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export function writableDataDir() {
  if (process.env.BLANWHI_DATA_DIR) return process.env.BLANWHI_DATA_DIR;
  if (process.env.VERCEL || process.env.NODE_ENV === "production") return path.join("/tmp", "blanwhi-data");
  return path.join(process.cwd(), "data");
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
