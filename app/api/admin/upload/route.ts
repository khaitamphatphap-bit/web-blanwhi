import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { hasR2ImageStorage, uploadImageToR2 } from "@/lib/image-storage";

const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const maxUploadSize = 4 * 1024 * 1024;

export const runtime = "nodejs";

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
      if (!hasR2ImageStorage()) {
        return NextResponse.json({ error: "Chưa cấu hình Cloudflare R2 cho kho ảnh. Vào Vercel thêm R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_BASE_URL." }, { status: 500 });
      }

      const url = await uploadImageToR2({
        bytes,
        contentType: file.type,
        filename
      });

      return NextResponse.json({ url });
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, filename), bytes);

    return NextResponse.json({ url: `/uploads/${filename}` });
  } catch (error) {
    return jsonError(error);
  }
}
