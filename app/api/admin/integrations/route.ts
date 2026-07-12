import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { readIntegrationConfig, writeIntegrationConfig } from "@/lib/integrations";

export async function GET() {
  return NextResponse.json(await readIntegrationConfig(), {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}

export async function PUT(request: Request) {
  try {
    const config = await request.json();
    return NextResponse.json(await writeIntegrationConfig(config), {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  } catch (error) {
    return jsonError(error);
  }
}
