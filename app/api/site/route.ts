import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { readSiteContent, writeSiteContentFromAdmin } from "@/lib/site-content";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(await readSiteContent(), {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" }
  });
}

export async function PUT(request: Request) {
  try {
    const content = await request.json();
    return NextResponse.json(await writeSiteContentFromAdmin(content), {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" }
    });
  } catch (error) {
    return jsonError(error);
  }
}
