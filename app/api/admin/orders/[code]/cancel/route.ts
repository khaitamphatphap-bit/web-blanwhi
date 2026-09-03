import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { findOrderByCode, updateOrder } from "@/lib/orders";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import { QueueHandler } from "@/lib/pancake/queue-handler";
import { OrderService } from "@/lib/services/order-service";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";

type Params = { params: Promise<{ code: string }> };

function carrierHasAccepted(order: NonNullable<Awaited<ReturnType<typeof findOrderByCode>>>) {
  return ["delivered", "returning", "returned"].includes(order.shippingStatus || "");
}

async function withTimeout<T>(promise: Promise<T>, ms: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Pancake phản hồi chậm, hệ thống sẽ tự thử lại.")), ms);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { code } = await params;
    const body = await request.json().catch(() => ({})) as { reason?: string };
    const order = await findOrderByCode(code);
    if (!order) return NextResponse.json({ error: "Không tìm thấy đơn hàng." }, { status: 404 });
    const reason = body.reason?.trim() || "Admin hủy đơn";
    if (order.status === "cancelled" && order.pancakeStatus === "cancelled") return NextResponse.json({ ok: true, order });
    if (carrierHasAccepted(order)) {
      return NextResponse.json({ error: "Đơn đã giao cho đơn vị vận chuyển hoặc đang giao hàng nên không thể hủy trong admin." }, { status: 409 });
    }

    let current = order.status === "cancelled" ? order : await updateOrder(code, {
      status: "cancelled",
      trackingCode: "",
      shippingStatus: "cancelled",
      cancellationReason: reason,
      shippingMessage: `${reason}. Website đã ghi nhận ngay; POS đang được tự động đồng bộ.`
    }) || order;
    const orderSync = new OrderSyncService();

    if (current.deliveryType === "express" && current.deliveryOrderId && current.shippingStatus !== "cancelled") {
      current = await new OrderService().cancelExpressDelivery(code, reason);
    }
    let pancakeCancellationPending = false;
    const mayExistOnPancake = Boolean(current.pancakeOrderId
      || current.paymentMethod === "cod"
      || current.status === "paid");
    if (mayExistOnPancake && current.pancakeStatus !== "cancelled") {
      try {
        current = await withTimeout(orderSync.cancel(current), 3500);
      } catch (error) {
        const normalized = ExceptionHandler.normalize(error);
        if (!normalized.retryable) {
          await QueueHandler.enqueue("order.cancel", { orderCode: current.code });
        }
        pancakeCancellationPending = true;
        try { await QueueHandler.enqueue("order.cancel", { orderCode: current.code }); } catch { /* Queue failure must not undo the website cancellation. */ }
      }
    }
    if (current.inventoryReservationApplied && !current.inventoryReservationReleased) {
      try {
        current = await new InventoryService().releaseOrder(current);
      } catch {
        // Không để lỗi trả tồn kho chặn thao tác hủy đơn của admin.
      }
    }

    const wasPaid = current.status === "paid";
    const cancelled = await updateOrder(code, {
      status: "cancelled",
      pancakeStatus: pancakeCancellationPending ? current.pancakeStatus : "cancelled",
      trackingCode: "",
      shippingStatus: "cancelled",
      cancellationReason: reason,
      shippingMessage: pancakeCancellationPending
        ? `${reason}. Website đã ghi nhận; yêu cầu hủy POS đang được tự động thử lại.`
        : `${reason}. Đơn đã được hủy bởi admin trước khi bàn giao cho đơn vị vận chuyển.`,
      inventoryReservationReleased: Boolean(current.inventoryReservationReleased),
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
