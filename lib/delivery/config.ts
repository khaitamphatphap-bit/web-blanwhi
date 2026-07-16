import type { DeliveryLocation, DeliveryProvider } from "@/lib/delivery/types";

export type DeliveryConfig = { provider: DeliveryProvider; apiKey: string; secret: string; baseUrl: string; market: string; fallbackFee: number; sender: DeliveryLocation };

function providerFromEnv(): DeliveryProvider {
  return String(process.env.DELIVERY_PROVIDER || "lalamove").toLowerCase() === "ahamove" ? "ahamove" : "lalamove";
}

export function readDeliveryConfig(): DeliveryConfig {
  const provider = providerFromEnv();
  return {
    provider,
    apiKey: process.env.DELIVERY_API_KEY || "",
    secret: process.env.DELIVERY_SECRET || "",
    baseUrl: process.env.DELIVERY_BASE_URL || (provider === "lalamove" ? "https://rest.lalamove.com" : "https://api.ahamove.com"),
    market: process.env.DELIVERY_MARKET || "VN",
    fallbackFee: Math.max(0, Number(process.env.DELIVERY_FALLBACK_FEE || 50000)),
    sender: {
      name: process.env.DELIVERY_PICKUP_NAME || "BLANWHI",
      phone: process.env.DELIVERY_PICKUP_PHONE || "",
      address: process.env.DELIVERY_PICKUP_ADDRESS || "",
      latitude: process.env.DELIVERY_PICKUP_LAT || "",
      longitude: process.env.DELIVERY_PICKUP_LNG || ""
    }
  };
}

export function deliveryConfigured(config = readDeliveryConfig()) {
  return Boolean(config.apiKey && (config.provider === "ahamove" || config.secret));
}

export function assertDeliveryConfigured(config = readDeliveryConfig()) {
  if (!deliveryConfigured(config)) throw new Error("Chưa cấu hình DELIVERY_API_KEY/DELIVERY_SECRET cho giao hỏa tốc.");
  if (!config.sender.phone || !config.sender.address) throw new Error("Thiếu DELIVERY_PICKUP_PHONE hoặc DELIVERY_PICKUP_ADDRESS.");
  if (!config.sender.latitude || !config.sender.longitude) throw new Error("Thiếu DELIVERY_PICKUP_LAT hoặc DELIVERY_PICKUP_LNG để báo giá hỏa tốc.");
}
