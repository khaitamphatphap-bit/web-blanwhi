import { createDeliveryService } from "@/lib/delivery/factory";
import { readDeliveryConfig } from "@/lib/delivery/config";
import { recipientFromCustomer, type DeliveryRequest, type DeliveryResult } from "@/lib/delivery/types";
import { findOrderByCode, updateOrder } from "@/lib/orders";
import type { ShopOrder } from "@/lib/types";

export class OrderService {
  private requestFor(order: ShopOrder): DeliveryRequest {
    const config = readDeliveryConfig();
    const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
    return {
      referenceCode: order.code,
      sender: config.sender,
      recipient: {
        ...recipientFromCustomer(order.customer),
        latitude: order.customer.latitude,
        longitude: order.customer.longitude
      },
      package: {
        cod: order.paymentMethod === "cod" ? order.total : 0,
        weightGrams: order.deliveryWeightGrams || Math.max(500, quantity * 300),
        lengthCm: order.deliveryLengthCm || 30,
        widthCm: order.deliveryWidthCm || 25,
        heightCm: order.deliveryHeightCm || Math.max(5, quantity * 3),
        items: order.items
      },
      note: order.customer.note || order.code,
      quotationId: order.deliveryQuotationId
    };
  }

  async createExpressDelivery(code: string) {
    const order = await this.requireExpressOrder(code);
    if (order.deliveryOrderId) return order;
    const result = await createDeliveryService().createDeliveryOrder(this.requestFor(order));
    return this.applyDeliveryResult(order, result, "Đã tạo vận đơn hỏa tốc.");
  }

  async trackExpressDelivery(code: string) {
    const order = await this.requireExpressOrder(code);
    const result = await createDeliveryService().trackingDelivery(order);
    return this.applyDeliveryResult(order, result, "Đã cập nhật vận đơn hỏa tốc.");
  }

  async cancelExpressDelivery(code: string, reason?: string) {
    const order = await this.requireExpressOrder(code);
    const result = await createDeliveryService().cancelDeliveryOrder(order, reason);
    return this.applyDeliveryResult(order, result, "Đã hủy vận đơn hỏa tốc.");
  }

  private async requireExpressOrder(code: string) {
    const order = await findOrderByCode(code);
    if (!order) throw new Error("Không tìm thấy đơn hàng.");
    if (order.deliveryType !== "express") throw new Error("Đơn này không sử dụng giao hỏa tốc.");
    return order;
  }

  private async applyDeliveryResult(order: ShopOrder, result: DeliveryResult, message: string) {
    const feeChanged = result.fee > 0 && result.fee !== order.shipping;
    return await updateOrder(order.code, {
      deliveryProvider: result.provider,
      deliveryOrderId: result.orderId || order.deliveryOrderId,
      deliveryDriver: result.driver,
      deliveryTrackingUrl: result.trackingUrl || order.deliveryTrackingUrl,
      deliveryFeeActual: result.fee || order.deliveryFeeActual,
      shipping: result.fee || order.shipping,
      total: feeChanged ? Math.max(0, order.total - order.shipping + result.fee) : order.total,
      shippingFeeLabel: result.fee ? `${new Intl.NumberFormat("vi-VN").format(result.fee)}đ` : order.shippingFeeLabel,
      shippingCarrier: result.providerName,
      trackingCode: result.trackingCode || order.trackingCode,
      shippingStatus: result.status,
      shippingMessage: result.message || message,
      externalSync: { ...order.externalSync, shipping: `${result.providerName}: ${result.message || message}`, lastSyncedAt: new Date().toISOString() }
    }) || order;
  }
}
