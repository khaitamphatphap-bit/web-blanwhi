import { NextResponse } from "next/server";
import { readIntegrationConfig } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function GET() {
  const integrations = await readIntegrationConfig();
  return NextResponse.json({
    cod: true,
    vnpay: false,
    momo: false,
    bank_transfer: false,
    zalopay: integrations.payment.zalopay.enabled === true
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
