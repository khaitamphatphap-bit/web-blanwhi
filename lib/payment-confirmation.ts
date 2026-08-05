import { findOrderByCode, updateOrder, updateOrderStatus } from "@/lib/orders";
import { POSSyncService } from "@/lib/services/pos-sync-service";
import { queryZaloPayPayment, queryZaloPayRefund } from "@/lib/payment";
import type { IntegrationConfig } from "@/lib/integrations";
import type { ShopOrder } from "@/lib/types";

type VerifiedPayment = Partial<Pick<ShopOrder, "transactionId" | "providerOrderId" | "providerMessage">>;

export async function markVerifiedPayment(orderCode: string, payment: VerifiedPayment) {
  const current = await findOrderByCode(orderCode);
  if (!current) throw new Error("Không tìm thấy đơn hàng.");
  if (current.status === "cancelled") throw new Error("Đơn hàng đã hủy nên không thể xác nhận thanh toán.");
  if (current.status === "paid") return current;

  const updated = await updateOrderStatus(orderCode, "paid", payment);
  if (!updated) throw new Error("Không cập nhật được trạng thái thanh toán.");
  return updated;
}

export async function syncVerifiedOrderToPos(order: ShopOrder) {
  if (order.status !== "paid") return order;
  try {
    return await new POSSyncService().confirmOrder(order);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không gửi được đơn sang Pancake";
    return await updateOrder(order.code, {
      externalSync: {
        ...order.externalSync,
        pancake: `Đã thanh toán - chờ gửi lại Pancake: ${message}`,
        lastSyncedAt: new Date().toISOString()
      }
    }) || order;
  }
}

export async function reconcileZaloPayPayment(order: ShopOrder, paymentConfig: IntegrationConfig["payment"]) {
  if (order.paymentMethod !== "zalopay" || order.status !== "pending") return order;
  const result = await queryZaloPayPayment(order, paymentConfig);
  if (Number(result.return_code) !== 1) return order;
  if (!result.zp_trans_id) throw new Error("ZaloPay xác nhận thành công nhưng thiếu mã giao dịch.");
  if (Number(result.amount || 0) !== Number(order.total)) throw new Error("Số tiền ZaloPay không khớp giá trị đơn hàng.");

  const paid = await markVerifiedPayment(order.code, {
    transactionId: result.zp_trans_id,
    providerOrderId: result.app_trans_id,
    providerMessage: "ZaloPay verified payment success"
  });
  return syncVerifiedOrderToPos(paid);
}

export async function reconcileZaloPayRefund(order: ShopOrder, paymentConfig: IntegrationConfig["payment"]) {
  if (order.paymentMethod !== "zalopay" || order.refundStatus !== "pending" || !order.refundId) return order;
  const result = await queryZaloPayRefund(order.refundId, paymentConfig);
  const refundStatus = Number(result.refund_status || 0);
  if (refundStatus === 1) {
    return await updateOrder(order.code, {
      refundStatus: "succeeded",
      refundMessage: "ZaloPay xác nhận đã hoàn tiền thành công về tài khoản khách.",
      refundedAt: new Date().toISOString()
    }) || order;
  }
  if (refundStatus === 2 || Number(result.return_code || 0) === 2) {
    return await updateOrder(order.code, {
      refundStatus: "failed",
      refundMessage: result.sub_return_message || result.return_message || "ZaloPay báo hoàn tiền thất bại."
    }) || order;
  }
  return order;
}
