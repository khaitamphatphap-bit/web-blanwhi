import { NextResponse } from "next/server";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { PancakeLogger } from "@/lib/pancake/logger";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import { PancakeService } from "@/lib/pancake/pancake-service";
import { ProductLinkService } from "@/lib/pancake/product-link-service";
import { QueueHandler } from "@/lib/pancake/queue-handler";
import { buildProductInventory } from "@/lib/product-inventory";
import { readSiteContent } from "@/lib/site-content";
import { hasBlobStore, hasDatabase } from "@/lib/data-store";

async function dashboard() {
  const content = await readSiteContent();
  const logs = await PancakeLogger.list();
  const queue = await QueueHandler.list();
  const products = content.products.map((product) => {
    const classificationNames = new Map((product.classifications || []).map((item) => [item.id, item.name]));
    return {
      id: product.id,
      name: product.name,
      rows: buildProductInventory(product).map((item) => ({
        ...item,
        classificationName: item.classificationId ? classificationNames.get(item.classificationId) || item.classificationId : "",
        linked: Boolean(item.pancakeProductId || item.pancakeVariationId || item.pancakeSku),
        availableQuantity: InventoryService.available(item.publishQuantity, item.pancakeQuantity)
      }))
    };
  });
  return {
    configuration: {
      apiKey: Boolean(process.env.PANCAKE_API_KEY),
      token: Boolean(process.env.PANCAKE_TOKEN),
      shopId: Boolean(process.env.PANCAKE_SHOP_ID),
      webhookSecret: Boolean(process.env.PANCAKE_WEBHOOK_SECRET),
      baseUrl: process.env.PANCAKE_API_BASE_URL || "https://pos.pages.fm/api/v1"
    },
    storage: {
      database: hasDatabase(),
      blob: hasBlobStore(),
      persistent: hasDatabase() || hasBlobStore()
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
    const body = await request.json() as {
      action?: string;
      orderCode?: string;
      productId?: string;
      rowKey?: string;
      variationId?: string;
      variation?: { id?: string; productId?: string; sku?: string; quantity?: number };
    };
    if (body.action === "variations") {
      return NextResponse.json({ ok: true, result: await new ProductLinkService().variations() });
    }
    if (body.action === "link-product") {
      return NextResponse.json({ ok: true, result: await new ProductLinkService().update(body) });
    }
    let result: unknown;
    if (body.action === "test") result = await new PancakeService().testConnection();
    else if (body.action === "recover-links") result = await new ProductLinkService().recoverLinks();
    else if (body.action === "sync-inventory") result = await new InventoryService().sync();
    else if (body.action === "retry-order" && body.orderCode) result = await new OrderSyncService().retry(body.orderCode);
    else return NextResponse.json({ error: "Hành động Pancake không hợp lệ." }, { status: 400 });
    return NextResponse.json({ ok: true, result, dashboard: await dashboard() });
  } catch (error) {
    const normalized = ExceptionHandler.normalize(error);
    return NextResponse.json({ error: normalized.message, code: normalized.code }, { status: normalized.status });
  }
}
