import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { readAuthoritativeShippingConfig } from "@/lib/site-content";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json({ shipping: await readAuthoritativeShippingConfig() }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" }
    });
  } catch (error) {
    return jsonError(error);
  }
}
