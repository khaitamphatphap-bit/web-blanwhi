import { after, NextResponse } from "next/server";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import { WebhookController } from "@/lib/pancake/webhook-controller";
import { refreshMissingPancakeTracking } from "@/lib/pancake/tracking-refresh";

export async function POST(request: Request) {
  try {
    const order = await new WebhookController().handle(request);
    if (order && !order.trackingCode) {
      after(async () => {
        await refreshMissingPancakeTracking([order], { force: true, limit: 1, timeoutMs: 6000, source: "Webhook Pancake" });
      });
    }
    return NextResponse.json({ ok: true, order });
  } catch (error) {
    const normalized = ExceptionHandler.normalize(error);
    return NextResponse.json({ error: normalized.message, code: normalized.code }, { status: normalized.status });
  }
}
