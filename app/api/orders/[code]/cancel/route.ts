import { NextResponse } from "next/server";
import { findOrderByCode, updateOrder } from "@/lib/orders";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import { readIntegrationConfig } from "@/lib/integrations";
import { jsonError } from "@/lib/api-errors";
import { OrderService } from "@/lib/services/order-service";
import { refundZaloPayPayment } from "@/lib/payment";
import { reconcileZaloPayPayment } from "@/lib/payment-confirmation";

type Params = { params: Promise<{ code: string }> };

function phoneKey(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.startsWith("84") && digits.length > 10 ? `0${digits.slice(2)}` : digits;
}

function carrierHasAccepted(order: NonNullable<Awaited<ReturnType<typeof findOrderByCode>>>) {
  return ["delivered", "returning", "returned"].includes(order.shippingStatus || "");
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
    if (order.status === "cancelled" && order.pancakeStatus === "cancelled") {
      if (order.paymentMethod === "zalopay" && !order.transactionId && order.refundStatus !== "not_required") {
        const cleaned = await updateOrder(order.code, {
          refundStatus: "not_required",
          refundProvider: undefined,
          refundId: undefined,
          refundTransactionId: undefined,
          refundAmount: undefined,
          refundMessage: ""
        });
        return NextResponse.json({ ok: true, order: cleaned || order });
      }
      return NextResponse.json({ ok: true, order });
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
    if (carrierHasAccepted(current)) {
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
      shippingMessage: `${reason}. Website đã ghi nhận ngay; POS đang được tự động đồng bộ.`,
      ...(wasPaid ? {
        refundStatus: "pending" as const,
        refundProvider: current.paymentMethod,
        refundAmount: current.total,
        refundMessage: "Đã hủy đơn, đang gửi yêu cầu hoàn tiền."
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
      try {
        current = await orderSync.cancel(current);
      } catch {
        pancakeCancellationPending = true;
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
      shippingMessage: pancakeCancellationPending
        ? `${reason}. Website đã ghi nhận; yêu cầu hủy POS đang được tự động thử lại.`
        : `${reason}. Vận đơn đã được vô hiệu hóa trước khi bàn giao cho bưu tá.`,
      inventoryReservationReleased: Boolean(current.inventoryReservationReleased)
    });
    if (!cancellationAlreadyRecorded && wasPaid && current.paymentMethod === "zalopay" && cancelled) {
      try {
        const refund = await refundZaloPayPayment(current, config.payment, reason);
        const providerMessage = `${refund.return_message || ""} ${refund.sub_return_message || ""}`;
        const processing = Number(refund.return_code || 0) === 3
          || [-1, -16].includes(Number(refund.sub_return_code || 0))
          || /đang\s*(refund|hoàn|xử lý)|refunding|refund\s*in\s*progress|processing/i.test(providerMessage);
        const accepted = Number(refund.return_code || 0) === 1 || processing;
        cancelled = await updateOrder(code, {
          refundStatus: accepted ? "pending" : "failed",
          refundProvider: "zalopay",
          refundId: refund.m_refund_id,
          refundTransactionId: refund.refund_id ? String(refund.refund_id) : undefined,
          refundAmount: refund.amount,
          refundMessage: accepted
            ? "ZaloPay đã nhận yêu cầu hoàn tiền, đang xử lý chuyển tiền về tài khoản khách."
            : (refund.sub_return_message || refund.return_message || "ZaloPay chưa chấp nhận yêu cầu hoàn tiền.")
        }) || cancelled;
      } catch (error) {
        cancelled = await updateOrder(code, {
          refundStatus: "failed",
          refundProvider: "zalopay",
          refundAmount: current.total,
          refundMessage: error instanceof Error ? error.message : "Không gửi được yêu cầu hoàn tiền ZaloPay."
        }) || cancelled;
      }
    } else if (!cancellationAlreadyRecorded && wasPaid && cancelled) {
      cancelled = await updateOrder(code, {
        refundStatus: "pending",
        refundProvider: current.paymentMethod,
        refundAmount: current.total,
        refundMessage: "Cổng thanh toán này chưa hỗ trợ hoàn tự động; quản trị viên cần hoàn tiền và xác nhận giao dịch."
      }) || cancelled;
    }
    return NextResponse.json({ ok: true, order: cancelled, pancakeCancellationPending });
  } catch (error) {
    return jsonError(error);
  }
}
