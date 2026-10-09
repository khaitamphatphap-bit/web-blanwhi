import { after, NextResponse } from "next/server";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import { WebhookController } from "@/lib/pancake/webhook-controller";
import { refreshMissingPancakeTracking } from "@/lib/pancake/tracking-refresh";
import { PancakeService } from "@/lib/pancake/pancake-service";

export async function POST(request: Request) {
  try {
    const order = await new WebhookController("shop-2").handle(request);
    if (order && !order.trackingCode) {
      after(async () => {
        await refreshMissingPancakeTracking([order], {
          force: true,
          limit: 1,
          timeoutMs: 6000,
          source: "Webhook Pancake Shop 2"
        }, new PancakeService("shop-2"));
      });
    }
    return NextResponse.json({ ok: true, order });
  } catch (error) {
    const normalized = ExceptionHandler.normalize(error);
    return NextResponse.json({ error: normalized.message, code: normalized.code }, { status: normalized.status });
  }
}
