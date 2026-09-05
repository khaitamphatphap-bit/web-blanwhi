import { findOrderByCode, updateOrder, updateOrderStatus } from "@/lib/orders";
import { POSSyncService } from "@/lib/services/pos-sync-service";
import { queryZaloPayPayment, queryZaloPayRefund } from "@/lib/payment";
import { InventoryService } from "@/lib/pancake/inventory-service";
import type { IntegrationConfig } from "@/lib/integrations";
import type { ShopOrder } from "@/lib/types";

type VerifiedPayment = Partial<Pick<ShopOrder, "transactionId" | "providerOrderId" | "paymentProviderOrderId" | "providerMessage">>;

export async function markVerifiedPayment(orderCode: string, payment: VerifiedPayment) {
  const current = await findOrderByCode(orderCode);
  if (!current) throw new Error("Không tìm thấy đơn hàng.");
  if (current.status === "cancelled") throw new Error("Đơn hàng đã hủy nên không thể xác nhận thanh toán.");
  if (current.status === "paid") return current;

  const updated = current.paymentMethod === "zalopay" && current.inventoryReservationApplied
    ? await new InventoryService().confirmReservedPayment(orderCode, payment)
    : await updateOrderStatus(orderCode, "paid", payment);
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

export async function reconcileZaloPayPayment(order: ShopOrder, paymentConfig: IntegrationConfig["payment"], options: { syncPos?: boolean } = {}) {
  if (order.paymentMethod !== "zalopay" || order.status !== "pending") return order;
  const result = await queryZaloPayPayment(order, paymentConfig);
  if (Number(result.return_code) !== 1) return order;
  if (!result.zp_trans_id) throw new Error("ZaloPay xác nhận thành công nhưng thiếu mã giao dịch.");
  if (Number(result.amount || 0) !== Number(order.total)) throw new Error("Số tiền ZaloPay không khớp giá trị đơn hàng.");

  const paid = await markVerifiedPayment(order.code, {
    transactionId: result.zp_trans_id,
    paymentProviderOrderId: result.app_trans_id,
    providerMessage: "ZaloPay verified payment success"
  });
  return options.syncPos === false ? paid : syncVerifiedOrderToPos(paid);
}

function refundResponseIsProcessing(result: { return_code?: number; sub_return_code?: number; refund_status?: number; return_message?: string; sub_return_message?: string }) {
  const message = `${result.return_message || ""} ${result.sub_return_message || ""}`;
  return Number(result.refund_status || 0) === 3
    || Number(result.return_code || 0) === 3
    || [-1, -16].includes(Number(result.sub_return_code || 0))
    || /đang\s*(refund|hoàn|xử lý)|refunding|refund\s*in\s*progress|processing/i.test(message);
}

export async function reconcileZaloPayRefund(order: ShopOrder, paymentConfig: IntegrationConfig["payment"]) {
  const canRecheck = order.refundStatus === "pending" || order.refundStatus === "failed";
  if (order.paymentMethod !== "zalopay" || !canRecheck) return order;

  try {
    const payment = await queryZaloPayPayment(order, paymentConfig);
    if (Number(payment.refund_status || 0) === 1) {
      return await updateOrder(order.code, {
        refundStatus: "succeeded",
        refundMessage: "Đã hoàn tiền qua ZaloPay. Liên hệ Zalo 0866561480 để được hỗ trợ thêm.",
        refundedAt: new Date().toISOString()
      }) || order;
    }
  } catch {
    // Tiếp tục kiểm tra bằng mã hoàn tiền nếu truy vấn giao dịch gốc tạm thời chưa phản hồi.
  }

  const refundRequestId = order.refundTransactionId || order.refundId;
  if (!refundRequestId) return order;
  const result = await queryZaloPayRefund(refundRequestId, paymentConfig);
  const refundStatus = Number(result.refund_status || 0);
  const returnCode = Number(result.return_code || 0);
  const processing = refundResponseIsProcessing(result);
  if (refundStatus === 1 || (refundStatus === 0 && returnCode === 1 && !processing)) {
    return await updateOrder(order.code, {
      refundStatus: "succeeded",
      refundMessage: "Đã hoàn tiền qua ZaloPay. Liên hệ Zalo 0866561480 để được hỗ trợ thêm.",
      refundedAt: new Date().toISOString()
    }) || order;
  }
  if (processing) {
    return await updateOrder(order.code, {
      refundStatus: "pending",
      refundMessage: "ZaloPay đang xử lý hoàn tiền về tài khoản khách. Liên hệ Zalo 0866561480 để được hỗ trợ thêm."
    }) || order;
  }
  if (refundStatus === 2 || returnCode === 2) {
    return await updateOrder(order.code, {
      refundStatus: "failed",
      refundMessage: `${result.sub_return_message || result.return_message || "ZaloPay báo hoàn tiền thất bại."} Liên hệ Zalo 0866561480 để được hỗ trợ thêm.`
    }) || order;
  }
  return await updateOrder(order.code, {
    refundStatus: "pending",
    refundMessage: "Đang chờ ZaloPay cập nhật kết quả hoàn tiền. Liên hệ Zalo 0866561480 để được hỗ trợ thêm."
  }) || order;
}
