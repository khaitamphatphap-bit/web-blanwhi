import { after, NextResponse } from "next/server";
import { findOrderByCode, updateOrder } from "@/lib/orders";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { QueueHandler } from "@/lib/pancake/queue-handler";
import type { PancakeQueueJob } from "@/lib/pancake/types";
import { jsonError } from "@/lib/api-errors";
import { carrierHasAcceptedCustomerOrder } from "@/lib/order-state";
import { processOrderBackgroundJob } from "@/lib/order-background-jobs";
import { ServerTiming } from "@/lib/server-timing";

type Params = { params: Promise<{ code: string }> };

function phoneKey(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.startsWith("84") && digits.length > 10 ? `0${digits.slice(2)}` : digits;
}

function scheduleBackgroundJobs(jobs: PancakeQueueJob[]) {
  if (!jobs.length) return;
  after(async () => {
    await Promise.allSettled(jobs.map(async (job) => {
      await processOrderBackgroundJob(job);
      await QueueHandler.remove(job.id);
    }));
  });
}

export async function POST(request: Request, { params }: Params) {
  const timing = new ServerTiming();
  const response = (body: unknown, init?: ResponseInit) => NextResponse.json(body, {
    ...init,
    headers: { ...init?.headers, ...timing.headers("customer-cancel") }
  });
  try {
    const { code } = await params;
    const body = await request.json().catch(() => ({})) as { phone?: string; reason?: string };
    const order = await timing.measure("database_read", () => findOrderByCode(code));
    if (!order) return response({ error: "Không tìm thấy đơn hàng." }, { status: 404 });
    if (!phoneKey(body.phone) || phoneKey(body.phone) !== phoneKey(order.customer.phone)) {
      return response({ error: "Số điện thoại không khớp với đơn hàng." }, { status: 403 });
    }
    let current = order;
    if (carrierHasAcceptedCustomerOrder(current)) {
      return response({
        error: "Đơn đã giao cho đơn vị vận chuyển hoặc đang giao hàng nên không thể hủy trực tuyến.",
        order: current
      }, { status: 409 });
    }
    const cancellationAlreadyRecorded = current.status === "cancelled";
    const wasPaid = current.status === "paid" || Boolean(current.transactionId);
    const isZaloPay = current.paymentMethod === "zalopay";
    const preserveExistingRefundState = cancellationAlreadyRecorded && (
      ["succeeded", "pending", "failed"].includes(current.refundStatus || "")
      || (current.refundStatus === "not_required" && !wasPaid)
    );
    const needsZaloPayReview = isZaloPay
      && !wasPaid
      && !(cancellationAlreadyRecorded && current.refundStatus === "not_required");
    const prepareZaloPayRefund = isZaloPay
      && !preserveExistingRefundState
      && (wasPaid || needsZaloPayReview);
    const reason = body.reason?.trim() || "Khách yêu cầu hủy đơn";
    const expressNeedsCancellation = current.deliveryType === "express" && Boolean(current.deliveryOrderId);

    // Chỉ database và hoàn kho nằm trên đường phản hồi. Mọi API bên thứ ba đều
    // có tác vụ bền vững rồi chạy sau khi khách đã nhận kết quả hủy.
    let cancelled = await timing.measure("database_cancel", () => updateOrder(code, {
      status: "cancelled",
      trackingCode: "",
      shippingStatus: "cancelled",
      cancellationReason: reason,
      shippingMessage: `${reason}. Website đã ghi nhận ngay; POS đang được tự động đồng bộ.`,
      ...(preserveExistingRefundState ? {} : prepareZaloPayRefund ? {
        refundStatus: "pending" as const,
        refundProvider: "zalopay" as const,
        refundAmount: current.total,
        refundMessage: wasPaid
          ? "Đang gửi yêu cầu hoàn tiền qua ZaloPay. Liên hệ Zalo 0866561480 để được hỗ trợ thêm."
          : "Đang kiểm tra trạng thái ZaloPay trước khi hoàn tiền. Liên hệ Zalo 0866561480 để được hỗ trợ thêm."
      } : {
        refundStatus: "not_required" as const,
        refundProvider: undefined,
        refundId: undefined,
        refundTransactionId: undefined,
        refundAmount: undefined,
        refundMessage: ""
      })
    }));
    current = cancelled || { ...current, status: "cancelled", shippingStatus: "cancelled" };

    let inventoryReleaseFailed = false;
    if (current.inventoryReservationApplied && !current.inventoryReservationReleased) {
      try {
        current = await timing.measure("inventory_restore", () => new InventoryService().releaseOrder(current));
      } catch {
        inventoryReleaseFailed = true;
      }
    }

    const mayExistOnPancake = Boolean(current.pancakeOrderId
      || current.paymentMethod === "cod"
      || wasPaid);
    const jobs = await timing.measure("outbox", async () => {
      const queued = await Promise.all([
        mayExistOnPancake && current.pancakeStatus !== "cancelled"
          ? QueueHandler.enqueue("order.cancel", { orderCode: current.code }).catch(() => null)
          : Promise.resolve(null),
        expressNeedsCancellation
          ? QueueHandler.enqueue("express.cancel", { orderCode: current.code }).catch(() => null)
          : Promise.resolve(null),
        inventoryReleaseFailed
          ? QueueHandler.enqueue("inventory.release", { orderCode: current.code }).catch(() => null)
          : Promise.resolve(null),
        isZaloPay && ["pending", "failed"].includes(current.refundStatus || "")
          ? QueueHandler.enqueue("zalopay.refund", { orderCode: current.code }).catch(() => null)
          : Promise.resolve(null)
      ]);
      return queued.filter((job): job is PancakeQueueJob => Boolean(job));
    });
    scheduleBackgroundJobs(jobs);
    const pancakeCancellationPending = mayExistOnPancake && current.pancakeStatus !== "cancelled";
    cancelled = current;
    return response({
      ok: true,
      order: cancelled,
      pancakeCancellationPending,
      refundQueued: jobs.some((job) => job.type === "zalopay.refund"),
      cancellationAlreadyRecorded
    });
  } catch (error) {
    const failed = jsonError(error);
    Object.entries(timing.headers("customer-cancel")).forEach(([name, value]) => failed.headers.set(name, value));
    return failed;
  }
}
