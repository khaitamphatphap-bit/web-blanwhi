import type { DeliveryConfig } from "@/lib/delivery/config";
import { normalizeExpressStatus, providerLabel } from "@/lib/delivery/status";
import type { DeliveryQuote, DeliveryRequest, DeliveryResult, DeliveryService } from "@/lib/delivery/types";
import type { ShopOrder } from "@/lib/types";

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

export class AhamoveDeliveryService implements DeliveryService {
  constructor(private readonly config: DeliveryConfig) {}

  private path(request: DeliveryRequest) {
    const locations = [request.sender, request.recipient];
    for (const location of locations) if (!location.latitude || !location.longitude) throw new Error(`Thiếu tọa độ cho địa chỉ: ${location.address}`);
    return locations.map((location, index) => ({
      address: location.address,
      lat: Number(location.latitude),
      lng: Number(location.longitude),
      name: location.name,
      mobile: location.phone,
      cod: index === 1 ? request.package.cod : 0,
      remarks: index === 1 ? request.note || request.referenceCode : ""
    }));
  }

  private async request(method: "GET" | "POST", path: string, params: Record<string, string>) {
    const url = new URL(`${this.config.baseUrl.replace(/\/$/, "")}${path}`);
    const body = new URLSearchParams({ token: this.config.apiKey, ...params });
    if (method === "GET") for (const [key, value] of body) url.searchParams.set(key, value);
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      ...(method === "POST" ? { body } : {})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || record(payload).status === "FAILED") throw new Error(`Ahamove lỗi ${response.status}: ${record(payload).message || record(payload).description || "Không xử lý được yêu cầu."}`);
    return record(payload);
  }

  private common(request: DeliveryRequest) {
    return {
      order_time: "0",
      path: JSON.stringify(this.path(request)),
      service_id: process.env.DELIVERY_SERVICE_TYPE || "SGN-BIKE",
      requests: JSON.stringify([]),
      remarks: request.note || request.referenceCode
    };
  }

  async calculateShippingFee(request: DeliveryRequest): Promise<DeliveryQuote> {
    const data = await this.request("GET", "/v1/order/estimated_fee", this.common(request));
    return { provider: "ahamove", fee: Number(data.total_fee || data.fee || 0), currency: "VND", estimated: false, raw: data };
  }

  async createDeliveryOrder(request: DeliveryRequest): Promise<DeliveryResult> {
    const data = await this.request("POST", "/v1/order/create", { ...this.common(request), order_id: request.referenceCode });
    return this.toResult(data, 0);
  }

  async cancelDeliveryOrder(order: ShopOrder, reason = "Shop hủy đơn"): Promise<DeliveryResult> {
    if (!order.deliveryOrderId) throw new Error("Đơn chưa có mã Ahamove.");
    const data = await this.request("POST", "/v1/order/cancel", { order_id: order.deliveryOrderId, comment: reason });
    return this.toResult({ ...data, order_id: order.deliveryOrderId, status: "CANCELLED" }, order.deliveryFeeActual || order.shipping || 0);
  }

  async trackingDelivery(order: ShopOrder): Promise<DeliveryResult> {
    if (!order.deliveryOrderId) throw new Error("Đơn chưa có mã Ahamove.");
    return this.toResult(await this.request("GET", "/v1/order/detail", { order_id: order.deliveryOrderId }), order.deliveryFeeActual || order.shipping || 0);
  }

  private toResult(data: Record<string, any>, fallbackFee: number): DeliveryResult {
    const supplier = record(data.supplier);
    const orderId = String(data.order_id || data.id || "");
    return {
      provider: "ahamove",
      providerName: providerLabel("ahamove"),
      orderId,
      trackingCode: orderId,
      status: normalizeExpressStatus(data.status),
      fee: Number(data.total_fee || data.fee || fallbackFee || 0),
      driver: Object.keys(supplier).length ? { id: String(supplier.id || ""), name: supplier.name, phone: supplier.mobile, plateNumber: supplier.plate_number } : undefined,
      trackingUrl: data.share_link || data.tracking_link || "",
      message: String(data.status || ""),
      raw: data
    };
  }
}
