import { findOrderByCode } from "@/lib/orders";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import type { PancakeQueueJob } from "@/lib/pancake/types";
import { OrderService } from "@/lib/services/order-service";
import { processCancelledZaloPayRefund } from "@/lib/zalopay-cancel-refund";
import {
  connectionConfigured,
  pancakeConnection,
  pancakeConnectionForOrder,
  pancakeConnectionForQueue
} from "@/lib/pancake/connections";
import { PancakeService } from "@/lib/pancake/pancake-service";

export async function processOrderBackgroundJob(job: PancakeQueueJob) {
  const orderCode = String(job.payload.orderCode || "");
  if (job.type === "inventory.sync") {
    // Tồn kho website và Pancake được quản lý độc lập. Giữ tương thích với
    // tác vụ cũ nhưng tuyệt đối không đọc hoặc ghi số lượng giữa hai hệ thống.
    return;
  }
  if (job.type === "orders.poll") {
    const connectionIds = (["shop-1", "shop-2"] as const).filter((id) => connectionConfigured(pancakeConnection(id)));
    await Promise.all(connectionIds.map((id) => new OrderSyncService(new PancakeService(id)).pollStatuses()));
    return;
  }

  const order = await findOrderByCode(orderCode);
  if (!order) throw new Error(`Chưa đọc được đơn ${orderCode}; giữ tác vụ để thử lại.`);
  const connectionId = pancakeConnectionForQueue(job, order);
  if (connectionId !== pancakeConnectionForOrder(order)) {
    throw new Error(`Tác vụ ${job.id} không khớp shop đã chốt của đơn ${orderCode}.`);
  }
  const orderSync = new OrderSyncService(new PancakeService(connectionId));

  if (job.type === "order.create") {
    if (order.status === "cancelled") return;
    await orderSync.retry(orderCode);
    return;
  }
  if (job.type === "inventory.release") {
    if (order.status !== "cancelled" || order.inventoryReservationReleased) return;
    await new InventoryService().releaseOrder(order);
    return;
  }
  if (job.type === "order.cancel") {
    if (order.status !== "cancelled" || order.pancakeStatus === "cancelled") return;
    await orderSync.cancel(order, false);
    return;
  }
  if (job.type === "express.cancel") {
    if (order.status !== "cancelled" || order.deliveryType !== "express" || !order.deliveryOrderId) return;
    const cancelled = await new OrderService().cancelExpressDelivery(orderCode, order.cancellationReason || "Khách yêu cầu hủy đơn");
    if (cancelled.shippingStatus !== "cancelled") {
      throw new Error("Đơn vị vận chuyển chưa xác nhận hủy vận đơn; hệ thống sẽ thử lại.");
    }
    return;
  }
  if (job.type === "zalopay.refund") {
    const result = await processCancelledZaloPayRefund(orderCode, order.cancellationReason || "Khách yêu cầu hủy đơn");
    if (!result.completed) throw new Error(result.order.refundMessage || "ZaloPay đang xử lý hoàn tiền; sẽ kiểm tra lại.");
  }
}
