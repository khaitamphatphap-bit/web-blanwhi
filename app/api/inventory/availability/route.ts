import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import { InventoryService } from "@/lib/pancake/inventory-service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId") || undefined;
  const summary = url.searchParams.get("summary") === "true";
  try {
    const service = new InventoryService();
    // Tồn admin website là nguồn duy nhất cho checkout. Pancake quản lý tồn
    // riêng và chỉ nhận đúng SKU trong payload đơn của shop đang được chọn.
    const items = await service.availability(productId, false);
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
