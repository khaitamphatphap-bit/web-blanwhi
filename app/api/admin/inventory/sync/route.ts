import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    ok: true,
    mode: "independent",
    message: "Kho website và Pancake được nhập riêng; hệ thống không đồng bộ số lượng."
  });
}
