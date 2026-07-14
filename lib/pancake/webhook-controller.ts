import { PancakeIntegrationError } from "@/lib/pancake/exception-handler";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import { Validator } from "@/lib/pancake/validator";

export class WebhookController {
  constructor(private readonly orderSync = new OrderSyncService()) {}

  async handle(request: Request) {
    const expectedSecret = process.env.PANCAKE_WEBHOOK_SECRET || "";
    const actualSecret = request.headers.get("x-pancake-secret") || new URL(request.url).searchParams.get("secret") || "";
    if (!Validator.webhookSecret(actualSecret, expectedSecret)) {
      throw new PancakeIntegrationError("Webhook secret không hợp lệ.", "INVALID_WEBHOOK_SECRET", 401);
    }
    return this.orderSync.applyRemoteUpdate(await request.json() as Record<string, unknown>);
  }
}
