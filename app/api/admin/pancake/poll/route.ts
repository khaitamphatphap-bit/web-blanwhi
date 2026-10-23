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
    const errors: Array<{ step: string; message: string }> = [];
    const runStep = async <T>(step: string, action: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await action();
      } catch (error) {
        const message = ExceptionHandler.message(error);
        errors.push({ step, message });
        console.error(`[BLANWHI cron] ${step}: ${message}`);
        return fallback;
      }
    };
    // Drain durable customer-facing work first. The bounded batch prevents a
    // historical backlog from consuming the whole cron invocation.
    // Each order update holds an advisory-lock connection while it reads and
    // writes the authoritative record. Keep the durable queue sequential so a
    // small serverless Postgres pool always has capacity for those operations.
    const queue = await runStep("queue", () => QueueHandler.process(processOrderBackgroundJob, { limit: 20, concurrency: 1 }), { completed: 0, remaining: -1 });
    const paymentReservations = await runStep("zalopay-reservations", () => expireStaleZaloPayReservations(Date.now(), { limit: 10, queryTimeoutMs: 2500, syncPos: false }), null);
    const paymentReceipts = await runStep("zalopay-receipts", () => reconcileUnappliedZaloPayReceipts(), null);
    const pendingPayments = await runStep("zalopay-pending", () => reconcilePendingZaloPayPayments(Date.now(), { limit: 10, queryTimeoutMs: 2500, syncPos: false }), null);
    const cancelOnly = new URL(request.url).searchParams.get("cancelOnly") === "1";
    const connectionIds = (["shop-1", "shop-2"] as const).filter((id) => connectionConfigured(pancakeConnection(id)));
    const cancellations = [];
    for (const id of connectionIds) {
      cancellations.push(await runStep(`pancake-cancellations:${id}`, () => new OrderSyncService(new PancakeService(id)).reconcileCancellations({ limit: 10 }), null));
    }
    const backups = await runStep("database-backups", () => flushDatabaseBackupOutbox(20), -1);
    if (cancelOnly) return NextResponse.json({ ok: errors.length === 0, retryScheduled: errors.length > 0, errors, paymentReservations, paymentReceipts, pendingPayments, cancellations, queue, backups });
    const inventory = { mode: "independent", skipped: true, message: "Kho website và Pancake được nhập riêng." };
    const orders = [];
    for (const id of connectionIds) {
      orders.push(await runStep(`pancake-orders:${id}`, () => new OrderSyncService(new PancakeService(id)).pollStatuses(), null));
    }
    return NextResponse.json({ ok: errors.length === 0, retryScheduled: errors.length > 0, errors, paymentReservations, paymentReceipts, pendingPayments, cancellations, backups, inventory, orders, queue });
  } catch (error) {
    const normalized = ExceptionHandler.normalize(error);
    return NextResponse.json({ error: normalized.message, code: normalized.code }, { status: normalized.status });
  }
}
