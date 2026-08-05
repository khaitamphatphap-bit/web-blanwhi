import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    cod: true,
    vnpay: false,
    momo: false,
    bank_transfer: false,
    zalopay: true
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
