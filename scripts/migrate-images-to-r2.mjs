import fs from "node:fs";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const root = process.cwd();
const dataFile = path.join(root, "data", "site-content.json");
const blobHostPattern = /\.public\.blob\.vercel-storage\.com$/;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function cleanPrefix(value) {
  return value.replace(/^\/+|\/+$/g, "");
}

function cleanBaseUrl(value) {
  return value.replace(/\/+$/g, "");
}

function inferContentType(url) {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg" || ext === ".jfif") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

function isVercelBlobImageUrl(value) {
  if (typeof value !== "string" || !value.startsWith("https://")) return false;
  try {
    const url = new URL(value);
    return blobHostPattern.test(url.hostname) && /\.(png|jpe?g|jfif|webp|gif)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function collectImageUrls(value, urls = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectImageUrls(item, urls));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectImageUrls(item, urls));
  } else if (isVercelBlobImageUrl(value)) {
    urls.add(value);
  }
  return urls;
}

function replaceImageUrls(value, replacements) {
  if (Array.isArray(value)) return value.map((item) => replaceImageUrls(item, replacements));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceImageUrls(item, replacements)])
    );
  }
  return replacements.get(value) || value;
}

function makeR2Key(prefix, sourceUrl, index) {
  const source = new URL(sourceUrl);
  const originalName = decodeURIComponent(path.basename(source.pathname)).replace(/[^a-zA-Z0-9._-]/g, "-");
  return [prefix, "migrated", `${String(index + 1).padStart(4, "0")}-${originalName}`]
    .filter(Boolean)
    .join("/");
}

async function uploadUrlToR2(client, config, sourceUrl, index) {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Cannot download ${sourceUrl}: ${response.status}`);

  const contentType = response.headers.get("content-type") || inferContentType(sourceUrl);
  const key = makeR2Key(config.objectPrefix, sourceUrl, index);
  const bytes = Buffer.from(await response.arrayBuffer());

  await client.send(new PutObjectCommand({
    Bucket: config.bucketName,
    Key: key,
    Body: bytes,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable"
  }));

  return `${config.publicBaseUrl}/${key}`;
}

async function main() {
  const config = {
    accountId: requiredEnv("R2_ACCOUNT_ID"),
    bucketName: requiredEnv("R2_BUCKET_NAME"),
    accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    publicBaseUrl: cleanBaseUrl(requiredEnv("R2_PUBLIC_BASE_URL")),
    objectPrefix: cleanPrefix(process.env.R2_OBJECT_PREFIX || "blanwhi")
  };

  const content = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const urls = [...collectImageUrls(content)];
  if (urls.length === 0) {
    console.log("No Vercel Blob image URLs found.");
    return;
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

  const replacements = new Map();
  for (const [index, url] of urls.entries()) {
    process.stdout.write(`[${index + 1}/${urls.length}] ${url}\n`);
    const r2Url = await uploadUrlToR2(client, config, url, index);
    replacements.set(url, r2Url);
    process.stdout.write(`  -> ${r2Url}\n`);
  }

  const backupDir = path.join(root, "data", "backups", "site-content-r2-migration");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(dataFile, path.join(backupDir, `${timestamp}.json`));

  const nextContent = replaceImageUrls(content, replacements);
  fs.writeFileSync(dataFile, `${JSON.stringify(nextContent, null, 2)}\n`);
  console.log(`Updated ${replacements.size} image URLs in data/site-content.json`);

  await import("./embed-site-content.mjs");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
