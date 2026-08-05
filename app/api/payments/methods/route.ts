import { NextResponse } from "next/server";
import { readIntegrationConfig } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await readIntegrationConfig();
  const hasZaloPayEnv = Boolean(process.env.ZALOPAY_APP_ID && process.env.ZALOPAY_KEY1 && process.env.ZALOPAY_KEY2);
  const hasZaloPayAdmin = Boolean(config.payment.zalopay.appId && config.payment.zalopay.key1 && config.payment.zalopay.key2);
  return NextResponse.json({
    cod: true,
    vnpay: false,
    momo: false,
    bank_transfer: false,
    zalopay: Boolean(hasZaloPayAdmin || hasZaloPayEnv)
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
