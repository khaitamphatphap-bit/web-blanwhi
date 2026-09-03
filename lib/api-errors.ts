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
  const declaredStatus = Number((error as { status?: unknown } | null)?.status);
  const status = isStorageLimitMessage(message)
    ? 507
    : Number.isInteger(declaredStatus) && declaredStatus >= 400 && declaredStatus <= 599
      ? declaredStatus
      : 500;
  const code = String((error as { code?: unknown } | null)?.code || "").trim();
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
}
