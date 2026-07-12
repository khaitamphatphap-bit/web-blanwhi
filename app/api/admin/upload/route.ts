import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { jsonError } from "@/lib/api-errors";

const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const maxUploadSize = 4 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (!allowedTypes.has(file.type)) {
      return NextResponse.json({ error: "Chỉ hỗ trợ PNG, JPG, WEBP hoặc GIF." }, { status: 400 });
    }
    if (file.size > maxUploadSize) {
      return NextResponse.json({ error: "Ảnh quá lớn. Vui lòng chọn ảnh dưới 4MB hoặc nén ảnh trước khi upload." }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const bytes = Buffer.from(await file.arrayBuffer());
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    if (process.env.VERCEL || process.env.NODE_ENV === "production") {
      if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
        return NextResponse.json({ error: "Chưa cấu hình kho ảnh Vercel Blob cho website." }, { status: 500 });
      }

      const blob = await put(`blanwhi/${filename}`, bytes, {
        access: "public",
        contentType: file.type,
        addRandomSuffix: true
      });

      return NextResponse.json({ url: blob.url });
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, filename), bytes);

    return NextResponse.json({ url: `/uploads/${filename}` });
  } catch (error) {
    return jsonError(error);
  }
}
