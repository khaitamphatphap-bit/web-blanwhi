import type { IntegrationConfig } from "@/lib/integrations";
import { updateOrder } from "@/lib/orders";
import { refundZaloPayPayment, zaloPayRefundRequestId } from "@/lib/payment";
import { reconcileZaloPayRefund } from "@/lib/payment-confirmation";
import type { ShopOrder } from "@/lib/types";

export async function requestAutomaticZaloPayRefund(
  order: ShopOrder,
  config: IntegrationConfig,
  reason: string
) {
  if (order.paymentMethod !== "zalopay" || !order.transactionId || order.refundStatus === "succeeded") return order;

  if (order.refundTransactionId) {
    try {
      return await reconcileZaloPayRefund(order, config.payment);
    } catch (error) {
      return await updateOrder(order.code, {
        refundStatus: "pending",
        refundMessage: `${error instanceof Error ? error.message : "Chưa kiểm tra được kết quả hoàn tiền ZaloPay."} Liên hệ Zalo 0866561480 để được hỗ trợ thêm.`
      }) || order;
    }
  }

  const refundTransactionId = zaloPayRefundRequestId(order, config.payment);
  let current = await updateOrder(order.code, {
    refundStatus: "pending",
    refundProvider: "zalopay",
    refundTransactionId,
    refundAmount: order.total,
    refundMessage: "ZaloPay đang xử lý hoàn tiền. Liên hệ Zalo 0866561480 để được hỗ trợ thêm."
  }) || { ...order, refundTransactionId };

  try {
    const result = await refundZaloPayPayment(current, config.payment, reason);
    const returnCode = Number(result.return_code || 0);
    const message = result.sub_return_message || result.return_message || "";
    if (returnCode !== 1 && returnCode !== 3) {
      return await updateOrder(order.code, {
        refundStatus: "failed",
        refundProvider: "zalopay",
        refundId: result.refund_id ? String(result.refund_id) : undefined,
        refundTransactionId: result.m_refund_id,
        refundAmount: result.amount,
        refundMessage: `${message || "ZaloPay chưa chấp nhận yêu cầu hoàn tiền."} Liên hệ Zalo 0866561480 để được hỗ trợ thêm.`
      }) || current;
    }

    current = await updateOrder(order.code, {
      refundStatus: "pending",
      refundProvider: "zalopay",
      refundId: result.refund_id ? String(result.refund_id) : undefined,
      refundTransactionId: result.m_refund_id,
      refundAmount: result.amount,
      refundMessage: `${message || "ZaloPay đang xử lý hoàn tiền."} Liên hệ Zalo 0866561480 để được hỗ trợ thêm.`
    }) || current;
    try {
      return await reconcileZaloPayRefund(current, config.payment);
    } catch {
      return current;
    }
  } catch (error) {
    return await updateOrder(order.code, {
      refundStatus: "failed",
      refundProvider: "zalopay",
      refundTransactionId,
      refundAmount: order.total,
      refundMessage: `${error instanceof Error ? error.message : "Không gửi được yêu cầu hoàn tiền ZaloPay."} Liên hệ Zalo 0866561480 để được hỗ trợ thêm.`
    }) || current;
  }
}
