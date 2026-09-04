import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import { InventoryService } from "@/lib/pancake/inventory-service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId") || undefined;
  const refreshPancake = url.searchParams.get("refreshPancake") === "true";
  const summary = url.searchParams.get("summary") === "true";
  try {
    const service = new InventoryService();
    // Website publishQuantity is authoritative for customer checkout. Avoid
    // waiting for Pancake on every customer stock check; admin sync remains
    // available through the dedicated inventory sync flow.
    const items = await service.availability(productId, refreshPancake && service.configured());
    const inventoryVersion = createHash("sha1")
      .update(items.map((item) => `${item.productId}:${item.key}:${item.publishQuantity}`).join("|"))
      .digest("hex");
    return NextResponse.json({
      configured: service.configured(),
      ...(summary ? {} : { items }),
      inventoryVersion,
      syncedAt: new Date().toISOString()
    }, {
      headers: { "Cache-Control": summary ? "public, s-maxage=2, stale-while-revalidate=1" : "no-store, max-age=0" }
    });
  } catch (error) {
    const normalized = ExceptionHandler.normalize(error);
    return NextResponse.json({ error: normalized.message, code: normalized.code }, { status: normalized.status });
  }
}
