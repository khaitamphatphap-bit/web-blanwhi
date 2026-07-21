import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Khong the tu xac nhan chuyen khoan. Trang thai chi duoc cap nhat tu webhook ngan hang co chu ky hop le." },
    { status: 410 }
  );
}
