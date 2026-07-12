import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { readSiteContent, writeSiteContent } from "@/lib/site-content";

export async function GET() {
  return NextResponse.json(await readSiteContent(), {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}

export async function PUT(request: Request) {
  try {
    const content = await request.json();
    return NextResponse.json(await writeSiteContent(content), {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  } catch (error) {
    return jsonError(error);
  }
}
