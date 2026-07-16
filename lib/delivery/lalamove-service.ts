import { createHmac, randomUUID } from "node:crypto";
import type { DeliveryConfig } from "@/lib/delivery/config";
import { normalizeExpressStatus, providerLabel } from "@/lib/delivery/status";
import type { DeliveryQuote, DeliveryRequest, DeliveryResult, DeliveryService } from "@/lib/delivery/types";
import type { ShopOrder } from "@/lib/types";

function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, any>;
}

function coords(location: DeliveryRequest["sender"]) {
  if (!location.latitude || !location.longitude) throw new Error(`Thiếu tọa độ cho địa chỉ: ${location.address}`);
  return { lat: String(location.latitude), lng: String(location.longitude) };
}

export class LalamoveDeliveryService implements DeliveryService {
  constructor(private readonly config: DeliveryConfig) {}

  private async request(method: string, path: string, body?: unknown) {
    const timestamp = Date.now().toString();
    const jsonBody = body ? JSON.stringify(body) : "";
    const raw = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${jsonBody}`;
    const signature = createHmac("sha256", this.config.secret).update(raw).digest("hex");
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `hmac ${this.config.apiKey}:${timestamp}:${signature}`,
        Market: this.config.market,
        "Request-ID": randomUUID()
      },
      ...(body ? { body: jsonBody } : {})
    });
    const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Lalamove lỗi ${response.status}: ${record(payload).message || "Không xử lý được yêu cầu."}`);
    return record(payload).data || payload;
  }

  async calculateShippingFee(request: DeliveryRequest): Promise<DeliveryQuote> {
    const specialRequests = request.package.cod > 0 ? String(process.env.DELIVERY_COD_REQUEST || "COD").split(",").map((item) => item.trim()).filter(Boolean) : [];
    const data = record(await this.request("POST", "/v3/quotations", {
      data: {
        serviceType: process.env.DELIVERY_SERVICE_TYPE || "MOTORCYCLE",
        language: "vi_VN",
        ...(specialRequests.length ? { specialRequests } : {}),
        stops: [
          { coordinates: coords(request.sender), address: request.sender.address },
          { coordinates: coords(request.recipient), address: request.recipient.address }
        ],
        item: {
          quantity: Math.max(1, request.package.items.reduce((sum, item) => sum + item.quantity, 0)),
          weight: request.package.weightGrams <= 3000 ? "LESS_THAN_3_KG" : "BETWEEN_3_10_KG",
          categories: ["OTHERS"]
        }
      }
    }));
    return {
      provider: "lalamove",
      fee: Number(record(data.priceBreakdown).total || 0),
      currency: record(data.priceBreakdown).currency || "VND",
      quotationId: String(data.quotationId || ""),
      expiresAt: data.expiresAt,
      estimated: false,
      raw: data
    };
  }

  async createDeliveryOrder(request: DeliveryRequest): Promise<DeliveryResult> {
    const quote: DeliveryQuote = request.quotationId ? { provider: "lalamove", quotationId: request.quotationId, fee: 0, currency: "VND", estimated: false } : await this.calculateShippingFee(request);
    const detail = quote.raw ? record(quote.raw) : record(await this.request("GET", `/v3/quotations/${quote.quotationId}`));
    const stops = Array.isArray(detail.stops) ? detail.stops : [];
    if (!stops[0]?.stopId || !stops[1]?.stopId) throw new Error("Lalamove không trả về điểm lấy/giao hợp lệ.");
    const data = record(await this.request("POST", "/v3/orders", {
      data: {
        quotationId: quote.quotationId,
        sender: { stopId: stops[0].stopId, name: request.sender.name, phone: request.sender.phone },
        recipients: [{ stopId: stops[1].stopId, name: request.recipient.name, phone: request.recipient.phone, remarks: request.note || request.referenceCode }],
        isPODEnabled: true,
        metadata: { websiteOrderCode: request.referenceCode }
      }
    }));
    return this.toResult(await this.withDriver(data), Number(record(data.priceBreakdown).total || quote.fee || 0));
  }

  async cancelDeliveryOrder(order: ShopOrder): Promise<DeliveryResult> {
    if (!order.deliveryOrderId) throw new Error("Đơn chưa có mã Lalamove.");
    await this.request("DELETE", `/v3/orders/${encodeURIComponent(order.deliveryOrderId)}`);
    return this.toResult({ orderId: order.deliveryOrderId, status: "CANCELED" }, order.deliveryFeeActual || order.shipping || 0);
  }

  async trackingDelivery(order: ShopOrder): Promise<DeliveryResult> {
    if (!order.deliveryOrderId) throw new Error("Đơn chưa có mã Lalamove.");
    const data = record(await this.request("GET", `/v3/orders/${encodeURIComponent(order.deliveryOrderId)}`));
    return this.toResult(await this.withDriver(data), order.deliveryFeeActual || order.shipping || 0);
  }

  private async withDriver(data: Record<string, any>) {
    if (!data.orderId || !data.driverId) return data;
    try {
      const driver = record(await this.request("GET", `/v3/orders/${encodeURIComponent(String(data.orderId))}/drivers/${encodeURIComponent(String(data.driverId))}`));
      return { ...data, driver };
    } catch {
      return data;
    }
  }

  private toResult(data: Record<string, any>, fallbackFee: number): DeliveryResult {
    const driver = record(data.driver);
    return {
      provider: "lalamove",
      providerName: providerLabel("lalamove"),
      orderId: String(data.orderId || ""),
      trackingCode: String(data.orderId || ""),
      status: normalizeExpressStatus(data.status),
      fee: Number(record(data.priceBreakdown).total || fallbackFee || 0),
      driver: data.driverId || Object.keys(driver).length ? { id: String(data.driverId || driver.driverId || driver.id || ""), name: driver.name, phone: driver.phone, plateNumber: driver.plateNumber } : undefined,
      trackingUrl: data.shareLink || "",
      message: String(data.status || ""),
      raw: data
    };
  }
}
