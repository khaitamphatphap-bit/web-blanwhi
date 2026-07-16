import { NextResponse } from "next/server";
import { createDeliveryService } from "@/lib/delivery/factory";
import { deliveryConfigured, readDeliveryConfig } from "@/lib/delivery/config";
import { providerLabel } from "@/lib/delivery/status";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    address?: string;
    latitude?: string;
    longitude?: string;
    cod?: number;
    quantity?: number;
  };
  const config = readDeliveryConfig();
  const fallback = {
    provider: config.provider,
    providerName: providerLabel(config.provider),
    fee: config.fallbackFee,
    currency: "VND",
    estimated: true,
    message: "Phí tạm tính, sẽ cập nhật theo API khi tạo vận đơn."
  };
  if (!deliveryConfigured(config) || !body.latitude || !body.longitude || !body.address) {
    return NextResponse.json(fallback);
  }
  try {
    const quote = await createDeliveryService().calculateShippingFee({
      referenceCode: `QUOTE-${Date.now()}`,
      sender: config.sender,
      recipient: { name: "Khách hàng", phone: "", address: body.address, latitude: body.latitude, longitude: body.longitude },
      package: {
        cod: Math.max(0, Number(body.cod || 0)),
        weightGrams: Math.max(500, Number(body.quantity || 1) * 300),
        lengthCm: 30,
        widthCm: 25,
        heightCm: Math.max(5, Number(body.quantity || 1) * 3),
        items: []
      }
    });
    return NextResponse.json({ ...quote, providerName: providerLabel(quote.provider) });
  } catch (error) {
    return NextResponse.json({ ...fallback, message: error instanceof Error ? error.message : fallback.message });
  }
}
