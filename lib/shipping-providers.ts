import type { IntegrationConfig, ShippingProvider } from "@/lib/integrations";
import type { ShippingStatus, ShopOrder } from "@/lib/types";

type ShippingConfig = IntegrationConfig["shipping"];

export type ShippingProviderResult = {
  provider: ShippingProvider;
  carrier: string;
  trackingCode: string;
  status: ShippingStatus;
  message: string;
  payload: unknown;
};

const defaultStatusEndpoints: Record<ShippingProvider, string> = {
  ghn: "https://online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/detail",
  ghtk: "https://services.giaohangtietkiem.vn/services/shipment/v2",
  viettelpost: "https://partner.viettelpost.vn/v2/order/getOrderStatusByOrderNumber",
  shopee_express: "",
  vnpost: "",
  custom: ""
};

const providerNames: Record<ShippingProvider, string> = {
  ghn: "Giao Hàng Nhanh",
  ghtk: "Giao Hàng Tiết Kiệm",
  viettelpost: "ViettelPost",
  shopee_express: "Shopee Express",
  vnpost: "VNPost",
  custom: "Đơn vị vận chuyển"
};

export function shippingEndpointFor(provider: ShippingProvider) {
  return defaultStatusEndpoints[provider];
}

export function shippingProviderName(provider: ShippingProvider) {
  return providerNames[provider];
}

export function normalizeShippingStatus(value: unknown): ShippingStatus {
  const text = String(value || "").toLowerCase().trim();
  const numericStatus = /^-?\d+$/.test(text) ? Number(text) : NaN;
  if (numericStatus === 105 || numericStatus === 107) return "cancelled";
  if (numericStatus === 501) return "delivered";
  if ([502, 503, 504, 505, 506, 507, 508, 509, 510, 515].includes(numericStatus)) return "returning";
  if (numericStatus >= 200) return "shipping";
  if (numericStatus >= 0 && numericStatus < 200) return "ready_to_ship";
  if (["ready", "ready_to_ship", "created", "picking", "confirmed"].includes(text)) return "ready_to_ship";
  if (["picked", "picked_up", "accepted_by_carrier", "handover", "handed_to_carrier", "delivered_to_carrier"].includes(text)) return "shipping";
  if (["shipping", "delivering", "in_transit", "transporting", "on_delivery", "delivering_order", "dang_giao", "đang giao"].includes(text)) return "shipping";
  if (["delivered", "success", "completed", "finish", "done", "delivered_successfully", "giao_thanh_cong", "đã giao"].includes(text)) return "delivered";
  if (["delivery_failed", "failed_delivery", "delivery_fail", "failed", "fail", "not_delivered", "khong_giao_duoc", "không giao được"].includes(text)) return "delivery_failed";
  if (["returning", "returning_to_shop", "return", "returned", "return_transporting", "tra_hang", "hoan_hang", "đang hoàn"].includes(text)) return "returning";
  if (["cancelled", "canceled", "cancel", "huy", "hủy"].includes(text)) return "cancelled";
  if (!text) return "not_created";
  return "unknown";
}

function pickString(source: unknown, paths: string[]) {
  for (const path of paths) {
    const value = path.split(".").reduce<unknown>((current, key) => {
      if (current && typeof current === "object" && key in current) return (current as Record<string, unknown>)[key];
      return undefined;
    }, source);
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return "";
}

async function readPayload(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function resultFromPayload(provider: ShippingProvider, config: ShippingConfig, order: ShopOrder, payload: unknown): ShippingProviderResult {
  const rawStatus = pickString(payload, [
    "data.status",
    "data.order_status",
    "data.status_id",
    "data.ORDER_STATUS",
    "DATA.ORDER_STATUS",
    "order.status",
    "order.status_text",
    "order.status_id",
    "status",
    "shippingStatus",
    "state"
  ]);

  return {
    provider,
    carrier: pickString(payload, ["data.carrier", "carrier"]) || config.providerName || shippingProviderName(provider),
    trackingCode: pickString(payload, ["data.ORDER_NUMBER", "DATA.ORDER_NUMBER", "ORDER_NUMBER", "data.order_number", "data.order_code", "data.label_id", "data.trackingCode", "data.tracking_code", "order.ORDER_NUMBER", "order.order_number", "order.label", "order.tracking_id", "trackingCode", "tracking_code"]) || order.trackingCode || "",
    status: normalizeShippingStatus(rawStatus),
    message: pickString(payload, ["data.status_text", "data.message", "data.reason", "order.status_text", "message", "statusText", "description"]) || rawStatus,
    payload
  };
}

export async function fetchShippingStatus(config: ShippingConfig, order: ShopOrder): Promise<ShippingProviderResult> {
  const provider = config.provider || "custom";
  const endpoint = config.statusEndpoint || shippingEndpointFor(provider);
  if (!endpoint) throw new Error("Chưa nhập endpoint trạng thái vận chuyển.");
  if (!order.trackingCode) throw new Error("Đơn chưa có mã vận đơn.");

  if (provider === "ghn") return fetchGhnStatus(endpoint, config, order);
  if (provider === "ghtk") return fetchGhtkStatus(endpoint, config, order);
  if (provider === "viettelpost") return fetchViettelPostStatus(endpoint, config, order);
  return fetchCustomStatus(endpoint, config, order);
}

async function fetchGhnStatus(endpoint: string, config: ShippingConfig, order: ShopOrder) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Token: config.token,
      ...(config.shopId ? { ShopId: config.shopId } : {})
    },
    body: JSON.stringify({ order_code: order.trackingCode })
  });
  const payload = await readPayload(response);
  if (!response.ok) throw new Error(`GHN lỗi ${response.status}: ${pickString(payload, ["message"]) || "Không cập nhật được vận đơn."}`);
  return resultFromPayload("ghn", config, order, payload);
}

async function fetchGhtkStatus(endpoint: string, config: ShippingConfig, order: ShopOrder) {
  const url = endpoint.endsWith(`/${order.trackingCode}`) ? endpoint : `${endpoint.replace(/\/$/, "")}/${order.trackingCode}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Token: config.token
    }
  });
  const payload = await readPayload(response);
  if (!response.ok) throw new Error(`GHTK lỗi ${response.status}: ${pickString(payload, ["message"]) || "Không cập nhật được vận đơn."}`);
  return resultFromPayload("ghtk", config, order, payload);
}

async function fetchViettelPostStatus(endpoint: string, config: ShippingConfig, order: ShopOrder) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.token ? { Token: config.token, Authorization: `Bearer ${config.token}` } : {})
    },
    body: JSON.stringify({
      ORDER_NUMBER: order.trackingCode,
      orderNumber: order.trackingCode,
      order_code: order.trackingCode,
      client_id: config.clientId || undefined
    })
  });
  const payload = await readPayload(response);
  if (!response.ok) throw new Error(`ViettelPost lỗi ${response.status}: ${pickString(payload, ["message"]) || "Không cập nhật được vận đơn."}`);
  return resultFromPayload("viettelpost", config, order, payload);
}

export async function cancelShippingOrder(config: ShippingConfig, order: ShopOrder, reason = "Khách hàng hủy đơn") {
  if (config.provider !== "viettelpost") throw new Error("Hiện chỉ hỗ trợ tự hủy vận đơn Viettel Post.");
  if (!config.token) throw new Error("Thiếu API token Viettel Post để hủy vận đơn.");
  if (!order.trackingCode) return { ok: true, message: "Đơn chưa có mã vận đơn Viettel Post." };
  const response = await fetch("https://partner.viettelpost.vn/v2/order/UpdateOrder", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Token: config.token,
      Authorization: `Bearer ${config.token}`
    },
    body: JSON.stringify({ TYPE: 4, ORDER_NUMBER: order.trackingCode, NOTE: reason.slice(0, 150) })
  });
  const payload = await readPayload(response) as Record<string, unknown>;
  const failed = !response.ok || payload.error === true || (payload.status !== undefined && Number(payload.status) !== 200);
  if (failed) throw new Error(`Viettel Post không hủy được vận đơn: ${pickString(payload, ["message", "data.message"]) || `HTTP ${response.status}`}`);
  return { ok: true, message: pickString(payload, ["message"]) || "Đã hủy vận đơn Viettel Post." };
}

async function fetchCustomStatus(endpoint: string, config: ShippingConfig, order: ShopOrder) {
  const url = new URL(endpoint);
  url.searchParams.set("trackingCode", order.trackingCode || "");
  url.searchParams.set("orderCode", order.code);

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {})
    }
  });
  const payload = await readPayload(response);
  if (!response.ok) throw new Error(`Vận chuyển lỗi ${response.status}: ${pickString(payload, ["message"]) || "Không cập nhật được vận đơn."}`);
  return resultFromPayload("custom", config, order, payload);
}
