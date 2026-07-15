import { NextResponse } from "next/server";
import { findOrderByCode } from "@/lib/orders";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import { QueueHandler } from "@/lib/pancake/queue-handler";

export async function GET(request: Request) {
  const auth = request.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || "";
  if (secret && auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const inventory = await new InventoryService().sync();
    const orders = await new OrderSyncService().pollStatuses();
    const queue = await QueueHandler.process(async (job) => {
      if (job.type === "order.create") {
        const orderCode = String(job.payload.orderCode || "");
        const order = await findOrderByCode(orderCode);
        if (!order || order.status === "cancelled") return;
        await new OrderSyncService().retry(orderCode);
      } else if (job.type === "order.cancel") {
        const orderCode = String(job.payload.orderCode || "");
        const order = await findOrderByCode(orderCode);
        if (!order) return;
        await new OrderSyncService().cancel(order, false);
      } else if (job.type === "inventory.sync") {
        await new InventoryService().sync();
      }
    });
    return NextResponse.json({ ok: true, inventory, orders, queue });
  } catch (error) {
    const normalized = ExceptionHandler.normalize(error);
    return NextResponse.json({ error: normalized.message, code: normalized.code }, { status: normalized.status });
  }
}
