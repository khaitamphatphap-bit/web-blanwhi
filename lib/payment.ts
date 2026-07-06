import crypto from "crypto";
import { PaymentMethod, ShopOrder } from "@/lib/types";

const vnpayVersion = "2.1.0";

function env(name: string, fallback = "") {
  return process.env[name] || fallback;
}

function formatVnpDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function sortObject(input: Record<string, string | number>) {
  return Object.keys(input)
    .sort()
    .reduce<Record<string, string>>((result, key) => {
      result[key] = String(input[key]);
      return result;
    }, {});
}

function toQuery(input: Record<string, string>) {
  return new URLSearchParams(input).toString();
}

export function hmacSha512(data: string, secret: string) {
  return crypto.createHmac("sha512", secret).update(Buffer.from(data, "utf8")).digest("hex");
}

export function hmacSha256Base64(data: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64");
}

export function getBaseUrl(request: Request) {
  const configured = env("NEXT_PUBLIC_SITE_URL");
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export function createVnpayUrl(order: ShopOrder, request: Request) {
  const tmnCode = env("VNPAY_TMN_CODE", "DEMO");
  const hashSecret = env("VNPAY_HASH_SECRET");
  const paymentUrl = env("VNPAY_PAYMENT_URL", "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html");
  const baseUrl = getBaseUrl(request);
  const now = new Date();
  const expire = new Date(now.getTime() + 15 * 60 * 1000);
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1";
  const params = sortObject({
    vnp_Amount: order.total * 100,
    vnp_Command: "pay",
    vnp_CreateDate: formatVnpDate(now),
    vnp_CurrCode: "VND",
    vnp_ExpireDate: formatVnpDate(expire),
    vnp_IpAddr: ip,
    vnp_Locale: "vn",
    vnp_OrderInfo: `Thanh toan don hang ${order.code}`,
    vnp_OrderType: "fashion",
    vnp_ReturnUrl: `${baseUrl}/payment-result?provider=vnpay&orderCode=${order.code}`,
    vnp_TmnCode: tmnCode,
    vnp_TxnRef: order.code,
    vnp_Version: vnpayVersion
  });
  const query = toQuery(params);
  const secureHash = hashSecret ? hmacSha512(query, hashSecret) : "";
  return `${paymentUrl}?${query}${secureHash ? `&vnp_SecureHash=${secureHash}` : ""}`;
}

export function verifyVnpayParams(searchParams: URLSearchParams) {
  const secret = env("VNPAY_HASH_SECRET");
  if (!secret) return { ok: false, reason: "Missing VNPAY_HASH_SECRET" };
  const receivedHash = searchParams.get("vnp_SecureHash");
  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    if (key !== "vnp_SecureHash" && key !== "vnp_SecureHashType") params[key] = value;
  });
  const signed = toQuery(sortObject(params));
  const expected = hmacSha512(signed, secret);
  return { ok: expected === receivedHash, reason: expected === receivedHash ? "OK" : "Invalid signature" };
}

export async function createMomoPayment(order: ShopOrder, request: Request) {
  const endpoint = env("MOMO_ENDPOINT", "https://test-payment.momo.vn/v2/gateway/api/create");
  const partnerCode = env("MOMO_PARTNER_CODE", "MOMOBKUN20180529");
  const accessKey = env("MOMO_ACCESS_KEY");
  const secretKey = env("MOMO_SECRET_KEY");
  const baseUrl = getBaseUrl(request);
  const requestId = `${order.code}-${Date.now()}`;
  const orderInfo = `Thanh toan don hang ${order.code}`;
  const redirectUrl = `${baseUrl}/payment-result?provider=momo&orderCode=${order.code}`;
  const ipnUrl = `${baseUrl}/api/payments/momo-ipn`;
  const extraData = "";
  const requestType = "captureWallet";

  if (!accessKey || !secretKey) {
    return {
      payUrl: `${baseUrl}/payment-result?provider=momo&orderCode=${order.code}&resultCode=0&demo=1`,
      qrCodeUrl: "",
      deeplink: "",
      requestId,
      demo: true
    };
  }

  const rawSignature = [
    `accessKey=${accessKey}`,
    `amount=${order.total}`,
    `extraData=${extraData}`,
    `ipnUrl=${ipnUrl}`,
    `orderId=${order.code}`,
    `orderInfo=${orderInfo}`,
    `partnerCode=${partnerCode}`,
    `redirectUrl=${redirectUrl}`,
    `requestId=${requestId}`,
    `requestType=${requestType}`
  ].join("&");

  const signature = crypto.createHmac("sha256", secretKey).update(rawSignature).digest("hex");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      partnerCode,
      partnerName: "BLANWHI",
      storeId: "BLANWHI",
      requestId,
      amount: order.total,
      orderId: order.code,
      orderInfo,
      redirectUrl,
      ipnUrl,
      lang: "vi",
      requestType,
      autoCapture: true,
      extraData,
      signature
    })
  });
  return response.json() as Promise<{ payUrl?: string; qrCodeUrl?: string; deeplink?: string; requestId: string; message?: string }>;
}

export function verifyMomoBody(body: Record<string, unknown>) {
  const secretKey = env("MOMO_SECRET_KEY");
  const accessKey = env("MOMO_ACCESS_KEY");
  if (!secretKey || !accessKey) return { ok: false, reason: "Missing MOMO_SECRET_KEY or MOMO_ACCESS_KEY" };
  const received = String(body.signature ?? "");
  const rawSignature = [
    `accessKey=${accessKey}`,
    `amount=${body.amount ?? ""}`,
    `extraData=${body.extraData ?? ""}`,
    `message=${body.message ?? ""}`,
    `orderId=${body.orderId ?? ""}`,
    `orderInfo=${body.orderInfo ?? ""}`,
    `orderType=${body.orderType ?? ""}`,
    `partnerCode=${body.partnerCode ?? ""}`,
    `payType=${body.payType ?? ""}`,
    `requestId=${body.requestId ?? ""}`,
    `responseTime=${body.responseTime ?? ""}`,
    `resultCode=${body.resultCode ?? ""}`,
    `transId=${body.transId ?? ""}`
  ].join("&");
  const expected = crypto.createHmac("sha256", secretKey).update(rawSignature).digest("hex");
  return { ok: expected === received, reason: expected === received ? "OK" : "Invalid signature" };
}

export function fallbackPaymentUrl(order: ShopOrder, method: PaymentMethod, request: Request) {
  const baseUrl = getBaseUrl(request);
  return `${baseUrl}/payment-result?provider=${method}&orderCode=${order.code}&demo=1`;
}
