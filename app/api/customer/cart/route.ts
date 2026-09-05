import { NextResponse } from "next/server";
import { readCustomerSessionFromCookieHeader } from "@/lib/customer-session";
import { readCartDraft, removeCartDraft, saveCartDraft } from "@/lib/cart-drafts";

export const dynamic = "force-dynamic";

const maxDraftRequestBytes = 64 * 1024;

function customerDeviceId(request: Request) {
  return readCustomerSessionFromCookieHeader(request.headers.get("cookie"));
}

function noStoreJson(value: unknown, init?: ResponseInit) {
  const response = NextResponse.json(value, init);
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return response;
}

export async function GET(request: Request) {
  const deviceId = customerDeviceId(request);
  if (!deviceId) return noStoreJson({ error: "Phiên khách chưa sẵn sàng." }, { status: 401 });
  const draft = await readCartDraft(deviceId);
  return noStoreJson({ draft });
}

export async function POST(request: Request) {
  const deviceId = customerDeviceId(request);
  if (!deviceId) return noStoreJson({ error: "Phiên khách chưa sẵn sàng." }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxDraftRequestBytes) {
    return noStoreJson({ error: "Giỏ hàng tạm vượt giới hạn lưu." }, { status: 413 });
  }
  const rawBody = await request.text();
  if (rawBody.length > maxDraftRequestBytes) {
    return noStoreJson({ error: "Giỏ hàng tạm vượt giới hạn lưu." }, { status: 413 });
  }
  let body: { draft?: unknown };
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    return noStoreJson({ error: "Dữ liệu giỏ hàng không hợp lệ." }, { status: 400 });
  }
  const draft = await saveCartDraft(deviceId, body.draft);
  return noStoreJson({ ok: true, draft });
}

export async function DELETE(request: Request) {
  const deviceId = customerDeviceId(request);
  if (!deviceId) return noStoreJson({ error: "Phiên khách chưa sẵn sàng." }, { status: 401 });
  await removeCartDraft(deviceId);
  return noStoreJson({ ok: true });
}
