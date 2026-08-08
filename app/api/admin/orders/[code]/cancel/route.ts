import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { findOrderByCode, updateOrder } from "@/lib/orders";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import { OrderService } from "@/lib/services/order-service";

type Params = { params: Promise<{ code: string }> };

function carrierHasAccepted(order: NonNullable<Awaited<ReturnType<typeof findOrderByCode>>>) {
  if (["ready_to_ship", "driver_assigned", "shipping", "delivered", "delivery_failed", "returning", "returned"].includes(order.shippingStatus || "")) return true;
  return ["shipping", "completed", "returned"].includes(order.pancakeStatus || "");
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { code } = await params;
    const body = await request.json().catch(() => ({})) as { reason?: string };
    const order = await findOrderByCode(code);
    if (!order) return NextResponse.json({ error: "Không tìm thấy đơn hàng." }, { status: 404 });
    if (order.status === "cancelled") return NextResponse.json({ ok: true, order });
    if (carrierHasAccepted(order)) {
      return NextResponse.json({ error: "Đơn đã giao cho đơn vị vận chuyển hoặc đang giao hàng nên không thể hủy trong admin." }, { status: 409 });
    }

    const reason = body.reason?.trim() || "Admin hủy đơn";
    let current = order;
    const orderSync = new OrderSyncService();

    if (current.deliveryType === "express" && current.deliveryOrderId && current.shippingStatus !== "cancelled") {
      current = await new OrderService().cancelExpressDelivery(code, reason);
    }
    if ((current.pancakeOrderId || (current.providerOrderId && current.pancakeStatus)) && current.pancakeStatus !== "cancelled") {
      try {
        current = await orderSync.cancel(current);
      } catch {
        // Đơn vẫn được hủy trên website; hàng đợi Pancake sẽ thử lại nếu POS đang lỗi.
      }
    }
    if (current.inventoryReservationApplied && !current.inventoryReservationReleased) {
      try {
        await new InventoryService().reserve(current.items, "restore");
      } catch {
        // Không để lỗi trả tồn kho chặn thao tác hủy đơn của admin.
      }
    }

    const wasPaid = current.status === "paid";
    const cancelled = await updateOrder(code, {
      status: "cancelled",
      pancakeStatus: "cancelled",
      trackingCode: "",
      shippingStatus: "cancelled",
      shippingMessage: `${reason}. Đơn đã được hủy bởi admin trước khi bàn giao cho đơn vị vận chuyển.`,
      inventoryReservationReleased: true,
      refundStatus: wasPaid ? "pending" : "not_required",
      refundProvider: wasPaid ? current.paymentMethod : undefined,
      refundAmount: wasPaid ? current.total : undefined,
      refundMessage: wasPaid
        ? "Đơn đã thanh toán đã bị hủy; shop cần liên hệ khách để hoàn tiền thủ công."
        : ""
    });

    return NextResponse.json({ ok: true, order: cancelled });
  } catch (error) {
    return jsonError(error);
  }
}
