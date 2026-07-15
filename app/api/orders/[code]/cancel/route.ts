import { NextResponse } from "next/server";
import { findOrderByCode, updateOrder } from "@/lib/orders";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import { readIntegrationConfig } from "@/lib/integrations";
import { cancelShippingOrder, fetchShippingStatus } from "@/lib/shipping-providers";
import { jsonError } from "@/lib/api-errors";

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
  if (current.trackingCode && canUseDirectVtp && current.shippingStatus !== "cancelled") {
    await cancelShippingOrder(config.shipping, current, reason);
  }
  if (current.providerOrderId && current.pancakeStatus !== "cancelled") current = await orderSync.cancel(current);

  if (current.inventoryReservationApplied && !current.inventoryReservationReleased) {
    await new InventoryService().reserve(current.items, "restore");
  }
  const cancelled = await updateOrder(code, {
    status: "cancelled",
    pancakeStatus: "cancelled",
    trackingCode: "",
    shippingStatus: "cancelled",
    shippingMessage: `${reason}. Vận đơn đã được vô hiệu hóa trước khi bàn giao cho bưu tá.`,
    inventoryReservationReleased: true
  });
  return NextResponse.json({ ok: true, order: cancelled });
  } catch (error) {
    return jsonError(error);
  }
}
