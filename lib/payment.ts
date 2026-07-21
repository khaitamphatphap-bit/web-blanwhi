import crypto from "crypto";
import type { IntegrationConfig } from "@/lib/integrations";
import { PaymentMethod, ShopOrder } from "@/lib/types";

const vnpayVersion = "2.1.0";
type PaymentConfig = IntegrationConfig["payment"];

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

export function hmacSha256Hex(data: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

export function getBaseUrl(request: Request) {
  const configured = env("NEXT_PUBLIC_SITE_URL");
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export function createVnpayUrl(order: ShopOrder, request: Request, paymentConfig?: PaymentConfig) {
  const tmnCode = paymentConfig?.vnpay.tmnCode || env("VNPAY_TMN_CODE", "DEMO");
  const hashSecret = paymentConfig?.vnpay.hashSecret || env("VNPAY_HASH_SECRET");
  const paymentUrl = paymentConfig?.vnpay.paymentUrl || env("VNPAY_PAYMENT_URL", "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html");
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

export function verifyVnpayParams(searchParams: URLSearchParams, paymentConfig?: PaymentConfig) {
  const secret = paymentConfig?.vnpay.hashSecret || env("VNPAY_HASH_SECRET");
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

export async function createMomoPayment(order: ShopOrder, request: Request, paymentConfig?: PaymentConfig) {
  const endpoint = paymentConfig?.momo.endpoint || env("MOMO_ENDPOINT", "https://test-payment.momo.vn/v2/gateway/api/create");
  const partnerCode = paymentConfig?.momo.partnerCode || env("MOMO_PARTNER_CODE", "MOMOBKUN20180529");
  const accessKey = paymentConfig?.momo.accessKey || env("MOMO_ACCESS_KEY");
  const secretKey = paymentConfig?.momo.secretKey || env("MOMO_SECRET_KEY");
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

export function verifyMomoBody(body: Record<string, unknown>, paymentConfig?: PaymentConfig) {
  const secretKey = paymentConfig?.momo.secretKey || env("MOMO_SECRET_KEY");
  const accessKey = paymentConfig?.momo.accessKey || env("MOMO_ACCESS_KEY");
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

export async function createZaloPayPayment(order: ShopOrder, request: Request, paymentConfig?: PaymentConfig) {
  const endpoint = paymentConfig?.zalopay.endpoint || env("ZALOPAY_ENDPOINT", "https://sb-openapi.zalopay.vn/v2/create");
  const appId = paymentConfig?.zalopay.appId || env("ZALOPAY_APP_ID");
  const key1 = paymentConfig?.zalopay.key1 || env("ZALOPAY_KEY1");
  const baseUrl = getBaseUrl(request);
  const now = Date.now();
  const date = new Date();
  const yymmdd = `${String(date.getFullYear()).slice(-2)}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const appTransId = `${yymmdd}_${order.code}`;
  const appUser = order.customer.phone || order.customer.name || "blanwhi";
  const item = JSON.stringify(order.items.map((line) => ({
    itemid: line.productId,
    itemname: line.name,
    itemprice: line.unitPrice,
    itemquantity: line.quantity
  })));
  const embedData = JSON.stringify({
    redirecturl: `${baseUrl}/payment-result?provider=zalopay&orderCode=${order.code}`
  });

  if (!appId || !key1) {
    return {
      order_url: `${baseUrl}/payment-result?provider=zalopay&orderCode=${order.code}&demo=1`,
      app_trans_id: appTransId,
      demo: true
    };
  }

  const data = `${appId}|${appTransId}|${appUser}|${order.total}|${now}|${embedData}|${item}`;
  const body = new URLSearchParams({
    app_id: appId,
    app_user: appUser,
    app_time: String(now),
    amount: String(order.total),
    app_trans_id: appTransId,
    embed_data: embedData,
    item,
    description: `BLANWHI - thanh toan don hang ${order.code}`,
    bank_code: "",
    callback_url: `${baseUrl}/api/payments/zalopay-ipn`,
    mac: hmacSha256Hex(data, key1)
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  return response.json() as Promise<{ order_url?: string; zp_trans_token?: string; order_token?: string; app_trans_id?: string; return_code?: number; return_message?: string; demo?: boolean }>;
}

export function verifyZaloPayBody(body: Record<string, unknown>, paymentConfig?: PaymentConfig) {
  const key2 = paymentConfig?.zalopay.key2 || env("ZALOPAY_KEY2");
  if (!key2) return { ok: false, reason: "Missing ZALOPAY_KEY2" };
  const data = String(body.data ?? "");
  const received = String(body.mac ?? "");
  const expected = hmacSha256Hex(data, key2);
  return { ok: expected === received, reason: expected === received ? "OK" : "Invalid signature" };
}

export function hasPayOsConfig() {
  return Boolean(env("PAYOS_CLIENT_ID") && env("PAYOS_API_KEY") && env("PAYOS_CHECKSUM_KEY"));
}

function payOsSignatureData(data: Record<string, unknown>) {
  return Object.keys(data).sort().map((key) => {
    const value = data[key];
    const normalized = value === null || value === undefined
      ? ""
      : typeof value === "object" ? JSON.stringify(value) : String(value);
    return `${key}=${normalized}`;
  }).join("&");
}

function safeSignatureEqual(expected: string, received: string) {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(received, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function createPayOsPayment(order: ShopOrder, request: Request) {
  const clientId = env("PAYOS_CLIENT_ID");
  const apiKey = env("PAYOS_API_KEY");
  const checksumKey = env("PAYOS_CHECKSUM_KEY");
  if (!clientId || !apiKey || !checksumKey || !order.paymentProviderOrderId) {
    throw new Error("PAYOS_NOT_CONFIGURED");
  }
  const baseUrl = getBaseUrl(request);
  const orderCode = Number(order.paymentProviderOrderId);
  if (!Number.isSafeInteger(orderCode) || orderCode <= 0) throw new Error("PAYOS_INVALID_ORDER_CODE");
  const signedFields = {
    amount: Math.round(order.total),
    cancelUrl: `${baseUrl}/payment-result?provider=payos&orderCode=${encodeURIComponent(order.code)}&cancelled=1`,
    description: `BLANWHI ${order.code.slice(-5)}`,
    orderCode,
    returnUrl: `${baseUrl}/payment-result?provider=payos&orderCode=${encodeURIComponent(order.code)}`
  };
  const signature = hmacSha256Hex(payOsSignatureData(signedFields), checksumKey);
  const response = await fetch(`${env("PAYOS_API_URL", "https://api-merchant.payos.vn")}/v2/payment-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": clientId,
      "x-api-key": apiKey
    },
    body: JSON.stringify({
      ...signedFields,
      buyerName: order.customer.name,
      buyerEmail: order.customer.email || undefined,
      buyerPhone: order.customer.phone,
      buyerAddress: order.customer.address,
      items: [{ name: `Don hang ${order.code}`.slice(0, 100), quantity: 1, price: Math.round(order.total) }],
      expiredAt: Math.floor(Date.now() / 1000) + 15 * 60,
      signature
    })
  });
  const result = await response.json() as {
    code?: string;
    desc?: string;
    data?: { checkoutUrl?: string; paymentLinkId?: string; qrCode?: string; status?: string };
  };
  if (!response.ok || result.code !== "00" || !result.data?.checkoutUrl) {
    throw new Error(result.desc || `payOS error ${response.status}`);
  }
  return result.data;
}

export function verifyPayOsWebhook(body: Record<string, unknown>) {
  const checksumKey = env("PAYOS_CHECKSUM_KEY");
  if (!checksumKey) return { ok: false, reason: "Missing PAYOS_CHECKSUM_KEY" };
  const data = body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : {};
  const received = String(body.signature || "").toLowerCase();
  const expected = hmacSha256Hex(payOsSignatureData(data), checksumKey).toLowerCase();
  return {
    ok: Boolean(received) && safeSignatureEqual(expected, received),
    reason: expected === received ? "OK" : "Invalid signature",
    data
  };
}

export function fallbackPaymentUrl(order: ShopOrder, method: PaymentMethod, request: Request) {
  const baseUrl = getBaseUrl(request);
  return `${baseUrl}/payment-result?provider=${method}&orderCode=${order.code}&demo=1`;
}
