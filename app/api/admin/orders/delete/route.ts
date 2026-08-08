import { NextResponse } from "next/server";
import { deleteOrdersByCodes } from "@/lib/orders";
import { jsonError } from "@/lib/api-errors";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { codes?: string[] };
    const codes = Array.isArray(body.codes) ? body.codes.map((code) => String(code || "").trim()).filter(Boolean) : [];
    if (!codes.length) {
      return NextResponse.json({ error: "Chưa chọn đơn cần xóa." }, { status: 400 });
    }
    const result = await deleteOrdersByCodes(codes);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return jsonError(error);
  }
}
