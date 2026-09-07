import { after, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { readIntegrationConfig } from "@/lib/integrations";
import { findOrderByCode } from "@/lib/orders";
import { verifyZaloPayBody } from "@/lib/payment";
import { markVerifiedPayment, syncVerifiedOrderToPos } from "@/lib/payment-confirmation";
import { recordPaymentOrphan } from "@/lib/payment-orphans";
import { recordVerifiedZaloPayReceipt, updateZaloPayReceipt } from "@/lib/zalopay-payment-receipts";
import { QueueHandler } from "@/lib/pancake/queue-handler";

export async function POST(request: Request) {
  let receiptId = "";
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const integrations = await readIntegrationConfig();
    const verified = verifyZaloPayBody(body, integrations.payment);
    if (!verified.ok) {
      return NextResponse.json({ return_code: -1, return_message: verified.reason });
    }

    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(String(body.data ?? "{}")) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ return_code: -1, return_message: "Invalid callback data" });
    }

    const appTransId = String(data.app_trans_id ?? "");
    const transIdParts = appTransId.split("_");
    const orderCode = transIdParts[1]?.startsWith("R") ? transIdParts.slice(2).join("_") : transIdParts.slice(1).join("_");
    const amount = Number(data.amount ?? 0);
    const transactionId = data.zp_trans_id ? String(data.zp_trans_id) : undefined;
    const receipt = await recordVerifiedZaloPayReceipt({
      appTransId,
      transactionId: transactionId || "",
      orderCode,
      amount,
      payload: data
    });
    receiptId = receipt.id;
    const order = await findOrderByCode(orderCode);

    if (!order) {
      await recordPaymentOrphan({
        provider: "zalopay",
        orderCode,
        appTransId,
        transactionId,
        amount,
        reason: "order_not_found",
        message: "ZaloPay báo thanh toán thành công nhưng website không tìm thấy đơn tương ứng.",
        payload: data
      });
      await updateZaloPayReceipt(receipt.id, { status: "orphan", message: "Website chưa tìm thấy đơn tương ứng." });
      return NextResponse.json({ return_code: 0, return_message: "Order not found" });
    }
    if (order.total !== amount) {
      await recordPaymentOrphan({
        provider: "zalopay",
        orderCode,
        appTransId,
        transactionId,
        amount,
        reason: "amount_mismatch",
        message: `ZaloPay báo số tiền ${amount} nhưng đơn website là ${order.total}.`,
        payload: data
      });
      await updateZaloPayReceipt(receipt.id, { status: "amount_mismatch", message: "Số tiền ZaloPay không khớp đơn website." });
      return NextResponse.json({ return_code: 0, return_message: "Invalid amount" });
    }

    const paid = await markVerifiedPayment(orderCode, {
      transactionId,
      paymentProviderOrderId: appTransId,
      providerMessage: "ZaloPay payment success"
    });
    await updateZaloPayReceipt(receipt.id, {
      status: "applied",
      attempts: receipt.attempts + 1,
      message: "Đã cập nhật đơn sang trạng thái đã thanh toán."
    });
    const queued = await QueueHandler.enqueue("order.create", { orderCode: paid.code }).catch(() => null);
    after(async () => {
      const synced = await syncVerifiedOrderToPos(paid);
      if (queued && (synced.pancakeOrderId || synced.pancakeStatus === "packing")) {
        await QueueHandler.remove(queued.id);
      }
    });

    return NextResponse.json({ return_code: 1, return_message: "success" });
  } catch (error) {
    if (receiptId) {
      await updateZaloPayReceipt(receiptId, {
        status: "failed",
        message: error instanceof Error ? error.message : "Chưa cập nhật được đơn."
      }).catch(() => undefined);
    }
    const response = jsonError(error);
    const body = await response.json();
    return NextResponse.json({ return_code: -1, return_message: body.error }, { status: response.status });
  }
}
