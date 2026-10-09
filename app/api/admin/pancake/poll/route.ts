import { NextResponse } from "next/server";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import { QueueHandler } from "@/lib/pancake/queue-handler";
import { expireStaleZaloPayReservations, reconcilePendingZaloPayPayments } from "@/lib/zalopay-reservation";
import { reconcileUnappliedZaloPayReceipts } from "@/lib/zalopay-payment-receipts";
import { processOrderBackgroundJob } from "@/lib/order-background-jobs";
import { flushDatabaseBackupOutbox } from "@/lib/data-store";
import { connectionConfigured, pancakeConnection } from "@/lib/pancake/connections";
import { PancakeService } from "@/lib/pancake/pancake-service";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || "";
  if (secret && auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    // Drain durable customer-facing work first. The bounded batch prevents a
    // historical backlog from consuming the whole cron invocation.
    const queue = await QueueHandler.process(processOrderBackgroundJob, { limit: 20, concurrency: 4 });
    const paymentReservations = await expireStaleZaloPayReservations(Date.now(), { limit: 10, queryTimeoutMs: 2500, syncPos: false });
    const paymentReceipts = await reconcileUnappliedZaloPayReceipts();
    const pendingPayments = await reconcilePendingZaloPayPayments(Date.now(), { limit: 10, queryTimeoutMs: 2500, syncPos: false });
    const cancelOnly = new URL(request.url).searchParams.get("cancelOnly") === "1";
    const connectionIds = (["shop-1", "shop-2"] as const).filter((id) => connectionConfigured(pancakeConnection(id)));
    const cancellations = await Promise.all(connectionIds.map((id) =>
      new OrderSyncService(new PancakeService(id)).reconcileCancellations({ limit: 10 })
    ));
    const backups = await flushDatabaseBackupOutbox(20).catch(() => -1);
    if (cancelOnly) return NextResponse.json({ ok: true, paymentReservations, paymentReceipts, pendingPayments, cancellations, queue, backups });
    const inventory = { mode: "independent", skipped: true, message: "Kho website và Pancake được nhập riêng." };
    const orders = await Promise.all(connectionIds.map((id) =>
      new OrderSyncService(new PancakeService(id)).pollStatuses()
    ));
    return NextResponse.json({ ok: true, paymentReservations, paymentReceipts, pendingPayments, cancellations, backups, inventory, orders, queue });
  } catch (error) {
    const normalized = ExceptionHandler.normalize(error);
    return NextResponse.json({ error: normalized.message, code: normalized.code }, { status: normalized.status });
  }
}
