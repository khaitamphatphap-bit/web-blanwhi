import type { ShippingStatus } from "@/lib/types";

export function normalizeExpressStatus(value: unknown): ShippingStatus {
  const status = String(value || "").trim().toUpperCase();
  if (["ASSIGNING_DRIVER", "SEARCHING_DRIVER", "IDLE"].includes(status)) return "finding_driver";
  if (["ON_GOING", "ACCEPTED", "ASSIGNED", "DRIVER_ASSIGNED"].includes(status)) return "driver_assigned";
  if (["PICKED_UP", "IN_PROCESS", "IN_TRANSIT", "DELIVERING"].includes(status)) return "shipping";
  if (["COMPLETED", "DELIVERED", "SUCCESS"].includes(status)) return "delivered";
  if (["REJECTED", "EXPIRED", "FAILED", "FAIL"].includes(status)) return "delivery_failed";
  if (["CANCELED", "CANCELLED"].includes(status)) return "cancelled";
  return "awaiting_creation";
}

export function providerLabel(provider: "ahamove" | "lalamove") {
  return provider === "ahamove" ? "Ahamove" : "Lalamove";
}
