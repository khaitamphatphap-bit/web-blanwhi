import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const CUSTOMER_SESSION_COOKIE = "blanwhi_customer_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 365;
const CLAIM_TTL_SECONDS = 60 * 60 * 24 * 180;

type CustomerTokenPurpose = "session" | "claim";

type CustomerTokenPayload = {
  version: 1;
  deviceId: string;
  purpose: CustomerTokenPurpose;
  expiresAt: number;
};

function signingSecret() {
  const secret = process.env.CUSTOMER_SESSION_SECRET
    || process.env.DATA_ENCRYPTION_KEY
    || process.env.PANCAKE_WEBHOOK_SECRET
    || process.env.ADMIN_PASSWORD;
  if (secret) return secret;
  if (process.env.NODE_ENV !== "production") return "blanwhi-local-customer-session-secret";
  throw new Error("CUSTOMER_SESSION_SECRET_NOT_CONFIGURED");
}

export function sanitizeCustomerDeviceId(value: unknown) {
  const deviceId = String(value || "").trim().slice(0, 100);
  return /^[A-Za-z0-9._:-]{8,100}$/.test(deviceId) ? deviceId : "";
}

function signature(encodedPayload: string) {
  return createHmac("sha256", signingSecret()).update(encodedPayload).digest("base64url");
}

export function createCustomerToken(deviceId: string, purpose: CustomerTokenPurpose, now = Date.now()) {
  const normalizedDeviceId = sanitizeCustomerDeviceId(deviceId);
  if (!normalizedDeviceId) throw new Error("INVALID_CUSTOMER_DEVICE_ID");
  const ttl = purpose === "claim" ? CLAIM_TTL_SECONDS : SESSION_TTL_SECONDS;
  const payload: CustomerTokenPayload = {
    version: 1,
    deviceId: normalizedDeviceId,
    purpose,
    expiresAt: Math.floor(now / 1000) + ttl
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signature(encodedPayload)}`;
}

export function verifyCustomerToken(token: unknown, purpose: CustomerTokenPurpose, now = Date.now()) {
  const [encodedPayload, receivedSignature, ...extra] = String(token || "").split(".");
  if (!encodedPayload || !receivedSignature || extra.length) return "";
  const expectedSignature = signature(encodedPayload);
  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return "";
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as CustomerTokenPayload;
    if (payload.version !== 1 || payload.purpose !== purpose || payload.expiresAt <= Math.floor(now / 1000)) return "";
    return sanitizeCustomerDeviceId(payload.deviceId);
  } catch {
    return "";
  }
}

export function customerSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  };
}

export function readCustomerSessionFromCookieHeader(cookieHeader: string | null) {
  const cookie = String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CUSTOMER_SESSION_COOKIE}=`));
  if (!cookie) return "";
  const token = decodeURIComponent(cookie.slice(CUSTOMER_SESSION_COOKIE.length + 1));
  return verifyCustomerToken(token, "session");
}

export function newCustomerDeviceId() {
  return randomUUID();
}
