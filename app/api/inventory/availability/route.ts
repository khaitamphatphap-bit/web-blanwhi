import { NextResponse } from "next/server";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import { InventoryService } from "@/lib/pancake/inventory-service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const productId = url.searchParams.get("productId") || undefined;
  try {
    const service = new InventoryService();
    const items = await service.availability(productId, service.configured());
    return NextResponse.json({ configured: service.configured(), items, syncedAt: new Date().toISOString() }, {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  } catch (error) {
    const normalized = ExceptionHandler.normalize(error);
    return NextResponse.json({ error: normalized.message, code: normalized.code }, { status: normalized.status });
  }
}
