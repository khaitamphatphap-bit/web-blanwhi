import { NextResponse } from "next/server";
import { readIntegrationConfig } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await readIntegrationConfig();
  const hasVnpayEnv = Boolean(process.env.VNPAY_TMN_CODE && process.env.VNPAY_HASH_SECRET);
  const hasMomoEnv = Boolean(process.env.MOMO_PARTNER_CODE && process.env.MOMO_ACCESS_KEY && process.env.MOMO_SECRET_KEY);
  const hasZaloPayEnv = Boolean(process.env.ZALOPAY_APP_ID && process.env.ZALOPAY_KEY1 && process.env.ZALOPAY_KEY2);
  const hasVnpayAdmin = Boolean(config.payment.vnpay.tmnCode && config.payment.vnpay.hashSecret);
  const hasMomoAdmin = Boolean(config.payment.momo.partnerCode && config.payment.momo.accessKey && config.payment.momo.secretKey);
  const hasZaloPayAdmin = Boolean(config.payment.zalopay.appId && config.payment.zalopay.key1 && config.payment.zalopay.key2);
  return NextResponse.json({
    cod: true,
    vnpay: Boolean(hasVnpayAdmin || hasVnpayEnv),
    momo: Boolean(hasMomoAdmin || hasMomoEnv),
    zalopay: Boolean(hasZaloPayAdmin || hasZaloPayEnv)
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
