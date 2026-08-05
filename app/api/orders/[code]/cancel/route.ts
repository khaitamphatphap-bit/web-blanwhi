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
    if (order.status === "cancelled") {
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
    const wasPaid = current.status === "paid";
    const orderSync = new OrderSyncService();
    current = current.pancakeOrderId || current.pancakeStatus || wasPaid ? await orderSync.reconcileExisting(current) : current;
    if (carrierHasAccepted(current)) {
      return NextResponse.json({ error: "Đơn đã giao cho đơn vị vận chuyển hoặc đang giao hàng nên không thể hủy trực tuyến." }, { status: 409 });
    }

    const reason = body.reason?.trim() || "Khách yêu cầu hủy đơn";
    if (current.deliveryType === "express" && current.deliveryOrderId && current.shippingStatus !== "cancelled") {
      current = await new OrderService().cancelExpressDelivery(code, reason);
    }
    if ((current.pancakeOrderId || (current.providerOrderId && current.pancakeStatus)) && current.pancakeStatus !== "cancelled") current = await orderSync.cancel(current);

    if (current.inventoryReservationApplied && !current.inventoryReservationReleased) {
      await new InventoryService().reserve(current.items, "restore");
    }
    let cancelled = await updateOrder(code, {
      status: "cancelled",
      pancakeStatus: "cancelled",
      trackingCode: "",
      shippingStatus: "cancelled",
      shippingMessage: `${reason}. Vận đơn đã được vô hiệu hóa trước khi bàn giao cho bưu tá.`,
      inventoryReservationReleased: true,
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
    if (wasPaid && current.paymentMethod === "zalopay" && cancelled) {
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
    } else if (wasPaid && cancelled) {
      cancelled = await updateOrder(code, {
        refundStatus: "pending",
        refundProvider: current.paymentMethod,
        refundAmount: current.total,
        refundMessage: "Cổng thanh toán này chưa hỗ trợ hoàn tự động; quản trị viên cần hoàn tiền và xác nhận giao dịch."
      }) || cancelled;
    }
    return NextResponse.json({ ok: true, order: cancelled });
  } catch (error) {
    return jsonError(error);
  }
}
