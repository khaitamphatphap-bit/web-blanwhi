import { NextResponse } from "next/server";
import { findOrderByCode, updateOrder } from "@/lib/orders";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import { QueueHandler } from "@/lib/pancake/queue-handler";
import { readIntegrationConfig } from "@/lib/integrations";
import { jsonError } from "@/lib/api-errors";
import { OrderService } from "@/lib/services/order-service";
import { reconcileZaloPayPayment } from "@/lib/payment-confirmation";
import { requestAutomaticZaloPayRefund } from "@/lib/zalopay-refund-service";
import { carrierHasAcceptedCustomerOrder } from "@/lib/order-state";

type Params = { params: Promise<{ code: string }> };

function phoneKey(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.startsWith("84") && digits.length > 10 ? `0${digits.slice(2)}` : digits;
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
    const body = await request.json().catch(() => ({})) as { phone?: string; reason?: string };
    const order = await findOrderByCode(code);
    if (!order) return NextResponse.json({ error: "Không tìm thấy đơn hàng." }, { status: 404 });
    if (!phoneKey(body.phone) || phoneKey(body.phone) !== phoneKey(order.customer.phone)) {
      return NextResponse.json({ error: "Số điện thoại không khớp với đơn hàng." }, { status: 403 });
    }
    const config = await readIntegrationConfig();
    let current = order;
    if (current.status === "pending" && current.paymentMethod === "zalopay") {
      try {
        current = await reconcileZaloPayPayment(current, config.payment);
      } catch {
        // Không coi lỗi truy vấn hoặc giao dịch chưa thanh toán là một khoản cần hoàn tiền.
      }
    }
    if (carrierHasAcceptedCustomerOrder(current)) {
      return NextResponse.json({ error: "Đơn đã giao cho đơn vị vận chuyển hoặc đang giao hàng nên không thể hủy trực tuyến." }, { status: 409 });
    }
    const cancellationAlreadyRecorded = current.status === "cancelled";
    const wasPaid = current.status === "paid" || Boolean(current.transactionId);
    const reason = body.reason?.trim() || "Khách yêu cầu hủy đơn";
    const expressNeedsCancellation = current.deliveryType === "express" && Boolean(current.deliveryOrderId) && current.shippingStatus !== "cancelled";

    // Ghi nhận hủy trên website trước mọi cuộc gọi ra ngoài. Pancake/ZaloPay chậm
    // không được làm nút hủy quay lại trạng thái cũ hoặc khiến khách bấm nhiều lần.
    let cancelled = await updateOrder(code, {
      status: "cancelled",
      trackingCode: "",
      shippingStatus: "cancelled",
      cancellationReason: reason,
      shippingMessage: `${reason}. Website đã ghi nhận ngay; POS đang được tự động đồng bộ.`,
      ...(wasPaid ? {
        refundStatus: "pending" as const,
        refundProvider: current.paymentMethod,
        refundAmount: current.total,
        refundMessage: "Đang gửi yêu cầu hoàn tiền qua ZaloPay. Liên hệ Zalo 0866561480 để được hỗ trợ thêm."
      } : {
        refundStatus: "not_required" as const,
        refundProvider: undefined,
        refundId: undefined,
        refundTransactionId: undefined,
        refundAmount: undefined,
        refundMessage: ""
      })
    });
    current = cancelled || { ...current, status: "cancelled", shippingStatus: "cancelled" };

    const orderSync = new OrderSyncService();
    if (expressNeedsCancellation) {
      try {
        current = await new OrderService().cancelExpressDelivery(code, reason);
      } catch {
        // Trạng thái hủy trên website đã được khóa; tác vụ nền sẽ tiếp tục xử lý vận đơn.
      }
    }
    let pancakeCancellationPending = false;
    const mayExistOnPancake = Boolean(current.pancakeOrderId
      || current.paymentMethod === "cod"
      || wasPaid);
    if (mayExistOnPancake && current.pancakeStatus !== "cancelled") {
      pancakeCancellationPending = true;
      try {
        await QueueHandler.enqueue("order.cancel", { orderCode: current.code });
        current = await withTimeout(orderSync.cancel(current), 6500);
        pancakeCancellationPending = current.pancakeStatus !== "cancelled";
      } catch {
        try { await QueueHandler.enqueue("order.cancel", { orderCode: current.code }); } catch { /* Queue failure must not undo the website cancellation. */ }
      }
    }

    if (current.inventoryReservationApplied && !current.inventoryReservationReleased) {
      try {
        current = await new InventoryService().releaseOrder(current);
      } catch {
        // Không để lỗi đồng bộ tồn kho ngăn trạng thái hủy được lưu; hàng đợi POS sẽ tiếp tục xử lý.
      }
    }
    cancelled = await updateOrder(code, {
      pancakeStatus: pancakeCancellationPending ? current.pancakeStatus : "cancelled",
      trackingCode: "",
      shippingStatus: "cancelled",
      cancellationReason: reason,
      shippingMessage: pancakeCancellationPending
        ? `${reason}. Website đã ghi nhận; yêu cầu hủy POS đang được tự động thử lại.`
        : `${reason}. Vận đơn đã được vô hiệu hóa trước khi bàn giao cho bưu tá.`,
      inventoryReservationReleased: Boolean(current.inventoryReservationReleased)
    });
    if (!cancellationAlreadyRecorded && wasPaid && cancelled) {
      cancelled = await updateOrder(code, {
        refundStatus: "pending",
        refundProvider: current.paymentMethod,
        refundAmount: current.total,
        refundMessage: "Đang gửi yêu cầu hoàn tiền qua ZaloPay. Liên hệ Zalo 0866561480 để được hỗ trợ thêm."
      }) || cancelled;
    }
    if (cancelled && wasPaid && current.paymentMethod === "zalopay") {
      cancelled = await requestAutomaticZaloPayRefund(cancelled, config, reason);
    }
    return NextResponse.json({ ok: true, order: cancelled, pancakeCancellationPending });
  } catch (error) {
    return jsonError(error);
  }
}
