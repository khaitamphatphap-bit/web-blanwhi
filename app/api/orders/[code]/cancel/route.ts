import { NextResponse } from "next/server";
import { findOrderByCode, updateOrder } from "@/lib/orders";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import { readIntegrationConfig } from "@/lib/integrations";
import { cancelShippingOrder, fetchShippingStatus } from "@/lib/shipping-providers";
import { jsonError } from "@/lib/api-errors";
import { OrderService } from "@/lib/services/order-service";
import { refundZaloPayPayment } from "@/lib/payment";

type Params = { params: Promise<{ code: string }> };

function phoneKey(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function carrierHasAccepted(order: NonNullable<Awaited<ReturnType<typeof findOrderByCode>>>) {
  if (["shipping", "delivered", "delivery_failed", "returning", "returned"].includes(order.shippingStatus || "")) return true;
  return ["shipping", "completed", "returned"].includes(order.pancakeStatus || "");
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { code } = await params;
    const body = await request.json().catch(() => ({})) as { phone?: string; reason?: string };
    const order = await findOrderByCode(code);
    if (!order) return NextResponse.json({ error: "Không tìm thấy đơn hàng." }, { status: 404 });
    if (!phoneKey(body.phone) || phoneKey(body.phone) !== phoneKey(order.customer.phone)) {
      return NextResponse.json({ error: "Số điện thoại không khớp với đơn hàng." }, { status: 403 });
    }
    const orderSync = new OrderSyncService();
    let current = await orderSync.reconcileExisting(order);
    const config = await readIntegrationConfig();
    const canUseDirectVtp = config.shipping.enabled && config.shipping.provider === "viettelpost" && Boolean(config.shipping.token);
    if (current.trackingCode && canUseDirectVtp) {
      const latestShipping = await fetchShippingStatus(config.shipping, current);
      current = await updateOrder(code, {
        trackingCode: latestShipping.trackingCode,
        shippingCarrier: latestShipping.carrier,
        shippingStatus: latestShipping.status,
        shippingMessage: latestShipping.message
      }) || current;
    }
    if (carrierHasAccepted(current)) {
      return NextResponse.json({ error: "Viettel Post đã quét nhận bưu gửi nên đơn không thể hủy trực tuyến." }, { status: 409 });
    }

    const reason = body.reason?.trim() || "Khách yêu cầu hủy đơn";
    if (current.deliveryType === "express" && current.deliveryOrderId && current.shippingStatus !== "cancelled") {
      current = await new OrderService().cancelExpressDelivery(code, reason);
    }
    if (current.trackingCode && canUseDirectVtp && current.shippingStatus !== "cancelled") {
      await cancelShippingOrder(config.shipping, current, reason);
    }
    if (current.providerOrderId && current.pancakeStatus !== "cancelled") current = await orderSync.cancel(current);

    if (current.inventoryReservationApplied && !current.inventoryReservationReleased) {
      await new InventoryService().reserve(current.items, "restore");
    }
    const refundPatch = await refundZaloPayIfNeeded(current, config, reason);
    const cancelled = await updateOrder(code, {
      status: "cancelled",
      pancakeStatus: "cancelled",
      trackingCode: "",
      shippingStatus: "cancelled",
      shippingMessage: `${reason}. Vận đơn đã được vô hiệu hóa trước khi bàn giao cho bưu tá.`,
      inventoryReservationReleased: true,
      ...refundPatch
    });
    return NextResponse.json({ ok: true, order: cancelled });
  } catch (error) {
    return jsonError(error);
  }
}

async function refundZaloPayIfNeeded(
  order: NonNullable<Awaited<ReturnType<typeof findOrderByCode>>>,
  config: Awaited<ReturnType<typeof readIntegrationConfig>>,
  reason: string
) {
  if (order.status !== "paid" || order.paymentMethod !== "zalopay") {
    return { refundStatus: "not_required" as const };
  }
  if (order.refundStatus === "succeeded" || order.refundStatus === "pending") {
    return {};
  }

  const result = await refundZaloPayPayment(order, config.payment, reason);
  const returnCode = Number(result.return_code || 0);
  const message = result.sub_return_message || result.return_message || "";

  if (returnCode === 1 || returnCode === 3) {
    return {
      refundStatus: returnCode === 1 ? "succeeded" as const : "pending" as const,
      refundProvider: "zalopay",
      refundId: result.refund_id ? String(result.refund_id) : undefined,
      refundTransactionId: result.m_refund_id,
      refundAmount: result.amount,
      refundMessage: message || (returnCode === 1 ? "ZaloPay refund success" : "ZaloPay refund processing"),
      refundedAt: new Date().toISOString()
    };
  }

  await updateOrder(order.code, {
    refundStatus: "failed",
    refundProvider: "zalopay",
    refundTransactionId: result.m_refund_id,
    refundAmount: result.amount,
    refundMessage: message || "ZaloPay refund failed"
  });
  throw new Error(message || "ZaloPay chưa hoàn tiền được cho đơn này. Vui lòng kiểm tra trong ZaloPay Merchant.");
}
