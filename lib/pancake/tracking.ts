type TrackingStatus = "unknown" | "not_created" | "awaiting_creation" | "finding_driver" | "ready_to_ship" | "driver_assigned" | "shipping" | "delivered" | "delivery_failed" | "returning" | "returned" | "cancelled";

export type PancakeTrackingSnapshot = {
  trackingCode: string;
  trackingUrl: string;
  carrier: string;
  shippingStatus?: "ready_to_ship" | "shipping" | "delivered" | "delivery_failed" | "returning" | "returned" | "cancelled";
};

type CurrentTrackingState = {
  trackingCode?: string;
  shippingCarrier?: string;
  shippingStatus?: TrackingStatus;
  deliveryTrackingUrl?: string;
};

const trackingKeys = [
  "tracking_number", "tracking_no", "tracking_code", "trackingCode", "waybill_no", "waybill_code",
  "shipment_code", "shipping_code", "bill_code", "label_id", "extend_code", "tracking_id",
  "ORDER_NUMBER", "order_number", "order_number_vtp", "partner_order_code", "shipping_order_code",
  "logistics_code", "waybill"
];

const trackingUrlKeys = ["tracking_url", "trackingUrl", "tracking_link", "trackingLink", "url"];

function directText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if ((typeof value === "string" || typeof value === "number") && String(value).trim()) return String(value).trim();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      for (const nestedKey of ["value", "code", "tracking_code", "trackingCode", "extend_code", "tracking_number", "tracking_no"]) {
        const candidate = nested[nestedKey];
        if ((typeof candidate === "string" || typeof candidate === "number") && String(candidate).trim()) return String(candidate).trim();
      }
    }
  }
  return "";
}

export function deepPancakeText(payload: unknown, keys: string[], depth = 0): string {
  if (!payload || typeof payload !== "object" || depth > 7) return "";
  const record = payload as Record<string, unknown>;
  const direct = directText(record, keys);
  if (direct) return direct;
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = deepPancakeText(item, keys, depth + 1);
        if (found) return found;
      }
    } else {
      const found = deepPancakeText(value, keys, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function findSpxCode(payload: unknown, depth = 0): string {
  if (payload === null || payload === undefined || depth > 8) return "";
  if (typeof payload === "string" || typeof payload === "number") {
    return String(payload).match(/\bSPXVN[A-Z0-9]{8,}\b/i)?.[0]?.toUpperCase() || "";
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findSpxCode(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof payload === "object") {
    for (const item of Object.values(payload as Record<string, unknown>)) {
      const found = findSpxCode(item, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function validTrackingCode(value: unknown) {
  const code = String(value || "").trim().replace(/^['"]|['"]$/g, "");
  if (!code || /^https?:\/\//i.test(code)) return "";
  if (/^(\[object Object\]|BLW-|BLANWHI:)/i.test(code)) return "";
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(code)) return "";
  if (!/^[A-Z0-9][A-Z0-9._-]{5,63}$/i.test(code)) return "";
  return code.toUpperCase();
}

function trackingCodeFromUrl(value: string) {
  if (!/^https?:\/\//i.test(value)) return "";
  try {
    const url = new URL(value);
    for (const key of [...trackingKeys, "code", "order_code"]) {
      const code = validTrackingCode(url.searchParams.get(key));
      if (code) return code;
    }
    const hashQuery = url.hash.includes("?") ? url.hash.slice(url.hash.indexOf("?") + 1) : "";
    if (hashQuery) {
      const params = new URLSearchParams(hashQuery);
      for (const key of [...trackingKeys, "code", "order_code"]) {
        const code = validTrackingCode(params.get(key));
        if (code) return code;
      }
    }
    const segments = url.pathname.split("/").filter(Boolean).reverse();
    for (const segment of segments) {
      const code = validTrackingCode(decodeURIComponent(segment));
      if (code && !/^(tracking|track|shipment|order)$/i.test(code)) return code;
    }
  } catch {
    return "";
  }
  return "";
}

function normalizeCarrier(value: string, trackingCode: string) {
  const text = `${value} ${trackingCode}`.trim();
  if (/spx|shopee\s*x?press/i.test(text)) return "SPX Express";
  if (/viettel|\bvtp\b/i.test(text)) return "ViettelPost";
  if (/giao\s*hàng\s*nhanh|\bghn\b/i.test(text)) return "Giao Hàng Nhanh";
  if (/giao\s*hàng\s*tiết\s*kiệm|\bghtk\b/i.test(text)) return "Giao Hàng Tiết Kiệm";
  if (/vn\s*post|vietnam\s*post|bưu\s*điện/i.test(text)) return "VNPost";
  return value.trim();
}

function normalizeShippingStatus(payload: unknown): PancakeTrackingSnapshot["shippingStatus"] {
  const value = deepPancakeText(payload, [
    "shipping_status", "delivery_status", "shipment_status", "logistics_status", "partner_status",
    "shipping_state", "delivery_state", "status_name", "STATUS_NAME"
  ]).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/\s+/g, "_");
  if (!value) return undefined;
  if (/delivered|delivery_success|giao_thanh_cong|giao_hang_thanh_cong|da_giao/.test(value)) return "delivered";
  if (/returning|return_in_progress|dang_hoan/.test(value)) return "returning";
  if (/returned|return_completed|hoan_hang/.test(value)) return "returned";
  if (/cancelled|canceled|da_huy|huy_don/.test(value)) return "cancelled";
  if (/delivery_failed|failed_delivery|giao_that_bai|giao_khong_thanh_cong/.test(value)) return "delivery_failed";
  if (/shipping|delivering|in_transit|picked_up|handed_over|dang_giao|da_lay_hang|da_ban_giao/.test(value)) return "shipping";
  if (/ready_to_ship|ready_for_pickup|awaiting_pickup|cho_lay_hang|cho_ban_giao/.test(value)) return "ready_to_ship";
  return undefined;
}

export function extractPancakeSystemId(payload: unknown) {
  return deepPancakeText(payload, ["system_id", "systemId"]);
}

export function extractPancakeTracking(payload: unknown): PancakeTrackingSnapshot {
  const trackingUrl = deepPancakeText(payload, trackingUrlKeys);
  const trackingCode = findSpxCode(payload)
    || validTrackingCode(deepPancakeText(payload, trackingKeys))
    || trackingCodeFromUrl(trackingUrl);
  const carrier = normalizeCarrier(deepPancakeText(payload, [
    "partner_name", "shipping_partner", "shipping_carrier", "carrier", "carrier_name", "provider_name"
  ]), trackingCode);
  return {
    trackingCode,
    trackingUrl: /^https?:\/\//i.test(trackingUrl) ? trackingUrl : "",
    carrier,
    shippingStatus: normalizeShippingStatus(payload)
  };
}

const shippingProgress: Record<string, number> = {
  unknown: 0,
  not_created: 0,
  awaiting_creation: 1,
  finding_driver: 1,
  ready_to_ship: 2,
  driver_assigned: 2,
  shipping: 3,
  delivery_failed: 3,
  returning: 3,
  delivered: 4,
  returned: 4,
  cancelled: 4
};

export function buildTrackingOnlyPatch(current: CurrentTrackingState, snapshot: PancakeTrackingSnapshot) {
  if (!snapshot.trackingCode || current.shippingStatus === "cancelled") return null;
  const currentStatus = current.shippingStatus || "not_created";
  // Luồng này chỉ bổ sung mã vận đơn. Trạng thái chi tiết vẫn do luồng
  // đồng bộ trạng thái hiện có quản lý để một payload tracking không thể hủy
  // hay hoàn tất nhầm đơn.
  const shippingStatus = (shippingProgress[currentStatus] || 0) >= shippingProgress.ready_to_ship
    ? currentStatus
    : "ready_to_ship";
  const carrier = snapshot.carrier || current.shippingCarrier || (/^SPX/i.test(snapshot.trackingCode) ? "SPX Express" : "");
  const statusMessage = shippingStatus === "delivered"
    ? "Đơn hàng đã được giao thành công."
    : shippingStatus === "shipping"
      ? `${carrier || "Đơn vị vận chuyển"} đã nhận hàng và đang vận chuyển.`
      : `Đã có mã vận đơn ${carrier || "từ đơn vị vận chuyển"}.`;
  return {
    trackingCode: snapshot.trackingCode,
    ...(snapshot.trackingUrl ? { deliveryTrackingUrl: snapshot.trackingUrl } : {}),
    ...(carrier ? { shippingCarrier: carrier } : {}),
    shippingStatus,
    shippingMessage: statusMessage
  };
}
