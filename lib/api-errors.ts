import { NextResponse } from "next/server";

function isStorageLimitMessage(message: string) {
  const text = message.toLowerCase();
  return (
    text.includes("dung lượng") ||
    text.includes("quota") ||
    text.includes("storage limit") ||
    text.includes("storage exceeded") ||
    text.includes("no space") ||
    text.includes("disk full") ||
    text.includes("enospc")
  );
}

export function jsonError(error: unknown) {
  const message = error instanceof Error ? error.message : "Có lỗi xảy ra. Vui lòng thử lại.";
  const status = isStorageLimitMessage(message) ? 507 : 500;
  return NextResponse.json({ error: message }, { status });
}
