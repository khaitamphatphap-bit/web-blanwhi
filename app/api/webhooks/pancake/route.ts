import { NextResponse } from "next/server";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import { WebhookController } from "@/lib/pancake/webhook-controller";

export async function POST(request: Request) {
  try {
    const order = await new WebhookController().handle(request);
    return NextResponse.json({ ok: true, order });
  } catch (error) {
    const normalized = ExceptionHandler.normalize(error);
    return NextResponse.json({ error: normalized.message, code: normalized.code }, { status: normalized.status });
  }
}
