import { AhamoveDeliveryService } from "@/lib/delivery/ahamove-service";
import { assertDeliveryConfigured, readDeliveryConfig } from "@/lib/delivery/config";
import { LalamoveDeliveryService } from "@/lib/delivery/lalamove-service";
import type { DeliveryService } from "@/lib/delivery/types";

export function createDeliveryService(): DeliveryService {
  const config = readDeliveryConfig();
  assertDeliveryConfigured(config);
  return config.provider === "ahamove" ? new AhamoveDeliveryService(config) : new LalamoveDeliveryService(config);
}
