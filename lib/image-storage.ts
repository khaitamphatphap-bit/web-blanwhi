import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type UploadImageInput = {
  bytes: Buffer;
  contentType: string;
  filename: string;
};

type R2Config = {
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  objectPrefix: string;
};

function cleanPrefix(value: string) {
  return value.replace(/^\/+|\/+$/g, "");
}

function cleanBaseUrl(value: string) {
  return value.replace(/\/+$/g, "");
}

function getR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucketName = process.env.R2_BUCKET_NAME;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;

  if (!accountId && !bucketName && !accessKeyId && !secretAccessKey && !publicBaseUrl) return null;
  if (!accountId || !bucketName || !accessKeyId || !secretAccessKey || !publicBaseUrl) {
    throw new Error("Thiếu cấu hình Cloudflare R2. Cần đủ R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_BASE_URL.");
  }

  return {
    accountId,
    bucketName,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: cleanBaseUrl(publicBaseUrl),
    objectPrefix: cleanPrefix(process.env.R2_OBJECT_PREFIX || "blanwhi")
  };
}

function makeImageKey(prefix: string, filename: string) {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
  return [prefix, safeFilename].filter(Boolean).join("/");
}

export function hasR2ImageStorage() {
  return Boolean(getR2Config());
}

export async function uploadImageToR2(input: UploadImageInput) {
  const config = getR2Config();
  if (!config) {
    throw new Error("Chưa cấu hình Cloudflare R2 cho kho ảnh.");
  }

  const key = makeImageKey(config.objectPrefix, input.filename);
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

  await client.send(new PutObjectCommand({
    Bucket: config.bucketName,
    Key: key,
    Body: input.bytes,
    ContentType: input.contentType,
    CacheControl: "public, max-age=31536000, immutable"
  }));

  return `${config.publicBaseUrl}/${key}`;
}
