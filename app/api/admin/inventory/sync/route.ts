import { NextResponse } from "next/server";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import { InventoryService } from "@/lib/pancake/inventory-service";

export async function POST() {
  try {
    const result = await new InventoryService().sync();
    return NextResponse.json({ content: result.content, message: `Đã đọc tồn kho Pancake và khớp ${result.linkedCount}/${result.remoteCount} biến thể.` });
  } catch (error) {
    const normalized = ExceptionHandler.normalize(error);
    return NextResponse.json({ error: normalized.message, code: normalized.code }, { status: normalized.status });
  }
}
