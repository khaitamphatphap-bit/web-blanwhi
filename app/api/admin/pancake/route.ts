import { NextResponse } from "next/server";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { PancakeLogger } from "@/lib/pancake/logger";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import { PancakeService } from "@/lib/pancake/pancake-service";
import { QueueHandler } from "@/lib/pancake/queue-handler";
import { buildProductInventory } from "@/lib/product-inventory";
import { readSiteContent } from "@/lib/site-content";

async function dashboard() {
  const content = await readSiteContent();
  const logs = await PancakeLogger.list();
  const queue = await QueueHandler.list();
  const products = content.products.map((product) => ({
    id: product.id,
    name: product.name,
    rows: buildProductInventory(product).map((item) => ({
      ...item,
      linked: Boolean(item.pancakeProductId || item.pancakeVariationId || item.pancakeSku),
      availableQuantity: InventoryService.available(item.publishQuantity, item.pancakeQuantity)
    }))
  }));
  return {
    configuration: {
      apiKey: Boolean(process.env.PANCAKE_API_KEY),
      token: Boolean(process.env.PANCAKE_TOKEN),
      shopId: Boolean(process.env.PANCAKE_SHOP_ID),
      webhookSecret: Boolean(process.env.PANCAKE_WEBHOOK_SECRET),
      baseUrl: process.env.PANCAKE_API_BASE_URL || "https://pos.pages.fm/api/v1"
    },
    webhookUrl: "/api/webhooks/pancake",
    products,
    logs: logs.slice(0, 100),
    queueCount: queue.length
  };
}

export async function GET() {
  return NextResponse.json(await dashboard(), { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; orderCode?: string };
    let result: unknown;
    if (body.action === "test") result = await new PancakeService().testConnection();
    else if (body.action === "sync-inventory") result = await new InventoryService().sync();
    else if (body.action === "retry-order" && body.orderCode) result = await new OrderSyncService().retry(body.orderCode);
    else return NextResponse.json({ error: "Hành động Pancake không hợp lệ." }, { status: 400 });
    return NextResponse.json({ ok: true, result, dashboard: await dashboard() });
  } catch (error) {
    const normalized = ExceptionHandler.normalize(error);
    return NextResponse.json({ error: normalized.message, code: normalized.code }, { status: normalized.status });
  }
}
