import { NextResponse } from "next/server";
import { readIntegrationConfig } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await readIntegrationConfig();
  return NextResponse.json({
    cod: true,
    vnpay: Boolean(config.payment.vnpay.enabled && config.payment.vnpay.tmnCode && config.payment.vnpay.hashSecret),
    momo: Boolean(config.payment.momo.enabled && config.payment.momo.partnerCode && config.payment.momo.accessKey && config.payment.momo.secretKey),
    zalopay: Boolean(config.payment.zalopay.enabled && config.payment.zalopay.appId && config.payment.zalopay.key1 && config.payment.zalopay.key2)
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
