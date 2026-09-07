import { readIntegrationConfig } from "@/lib/integrations";
import { findOrderByCode, updateOrder } from "@/lib/orders";
import { queryZaloPayPayment } from "@/lib/payment";
import { requestAutomaticZaloPayRefund } from "@/lib/zalopay-refund-service";

export async function processCancelledZaloPayRefund(orderCode: string, reason: string) {
  let order = await findOrderByCode(orderCode);
  if (!order) throw new Error(`Không tìm thấy đơn ${orderCode} để xử lý hoàn tiền.`);
  if (order.status !== "cancelled" || order.paymentMethod !== "zalopay") return { order, completed: true };
  if (order.refundStatus === "succeeded" || order.refundStatus === "not_required") return { order, completed: true };

  const config = await readIntegrationConfig();
  if (!order.transactionId) {
    const payment = await queryZaloPayPayment(order, config.payment);
    const returnCode = Number(payment.return_code || 0);
    if (returnCode === 1) {
      if (!payment.zp_trans_id) throw new Error("ZaloPay báo đã thanh toán nhưng thiếu mã giao dịch.");
      if (Number(payment.amount || 0) !== Number(order.total)) {
        throw new Error("Số tiền ZaloPay không khớp đơn đã hủy; chưa tự động hoàn tiền.");
      }
      order = await updateOrder(order.code, {
        transactionId: String(payment.zp_trans_id),
        paymentProviderOrderId: payment.app_trans_id || order.paymentProviderOrderId,
        paymentVerificationStatus: "verified",
        paymentLastCheckedAt: new Date().toISOString(),
        refundStatus: "pending",
        refundProvider: "zalopay",
        refundAmount: order.total,
        refundMessage: "Đã xác nhận thanh toán; đang gửi yêu cầu hoàn tiền qua ZaloPay. Liên hệ Zalo 0866561480 để được hỗ trợ thêm."
      }) || order;
    } else if (payment.is_processing === true || returnCode === 3) {
      throw new Error("ZaloPay vẫn đang xử lý giao dịch; hệ thống sẽ kiểm tra lại trước khi hoàn tiền.");
    } else if (returnCode === 2) {
      order = await updateOrder(order.code, {
        paymentVerificationStatus: "not_paid",
        paymentLastCheckedAt: new Date().toISOString(),
        refundStatus: "not_required",
        refundProvider: undefined,
        refundAmount: undefined,
        refundMessage: "ZaloPay xác nhận giao dịch chưa thanh toán nên không cần hoàn tiền."
      }) || order;
      return { order, completed: true };
    } else {
      throw new Error(payment.sub_return_message || payment.return_message || "Chưa xác nhận được trạng thái ZaloPay; hệ thống sẽ thử lại.");
    }
  }

  const refunded = await requestAutomaticZaloPayRefund(order, config, reason);
  return {
    order: refunded,
    completed: refunded.refundStatus === "succeeded" || refunded.refundStatus === "not_required"
  };
}
