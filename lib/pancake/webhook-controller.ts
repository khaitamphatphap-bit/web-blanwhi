import { PancakeIntegrationError } from "@/lib/pancake/exception-handler";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import { Validator } from "@/lib/pancake/validator";
import { pancakeConnection, type PancakeConnectionId } from "@/lib/pancake/connections";
import { PancakeService } from "@/lib/pancake/pancake-service";

export class WebhookController {
  private readonly orderSync: OrderSyncService;
  private readonly connectionId: PancakeConnectionId;

  constructor(connectionId: PancakeConnectionId = "shop-1") {
    this.connectionId = connectionId;
    this.orderSync = new OrderSyncService(new PancakeService(connectionId));
  }

  async handle(request: Request) {
    const expectedSecret = pancakeConnection(this.connectionId).webhookSecret;
    const actualSecret = request.headers.get("x-pancake-secret") || new URL(request.url).searchParams.get("secret") || "";
    if (!Validator.webhookSecret(actualSecret, expectedSecret)) {
      throw new PancakeIntegrationError("Webhook secret không hợp lệ.", "INVALID_WEBHOOK_SECRET", 401);
    }
    return this.orderSync.applyRemoteUpdate(await request.json() as Record<string, unknown>);
  }
}
