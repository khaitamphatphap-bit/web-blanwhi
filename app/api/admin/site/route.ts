import { NextResponse } from "next/server";
import { readSiteContent, writeSiteContent } from "@/lib/site-content";

export async function GET() {
  return NextResponse.json(await readSiteContent(), {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}

export async function PUT(request: Request) {
  const content = await request.json();
  return NextResponse.json(await writeSiteContent(content), {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
