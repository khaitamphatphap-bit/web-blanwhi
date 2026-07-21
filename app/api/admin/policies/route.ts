import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { defaultSiteContent, readSiteContent, writeSiteContentFromAdmin, type CmsPolicyDocument } from "@/lib/site-content";

export const dynamic = "force-dynamic";

function normalizePolicies(input: unknown): CmsPolicyDocument[] {
  if (!Array.isArray(input)) throw new Error("Dữ liệu chính sách không hợp lệ.");
  return (defaultSiteContent.policies || []).map((fallback) => {
    const candidate = input.find((item) => item && typeof item === "object" && String((item as CmsPolicyDocument).id) === fallback.id) as CmsPolicyDocument | undefined;
    if (!candidate || !Array.isArray(candidate.blocks)) return fallback;
    return {
      ...fallback,
      blocks: candidate.blocks.map((block) => ({
        text: String(block?.text || ""),
        runs: Array.isArray(block?.runs) && block.runs.length
          ? block.runs.map((run) => ({
              text: String(run?.text || ""),
              ...(run?.bold ? { bold: true } : {}),
              ...(run?.italic ? { italic: true } : {}),
              ...(run?.underline ? { underline: true } : {})
            }))
          : [{ text: String(block?.text || "") }],
        style: block?.style ? String(block.style) : null,
        listMarker: block?.listMarker ? String(block.listMarker) : null,
        listLevel: Math.max(0, Number(block?.listLevel) || 0)
      }))
    };
  });
}

function policyContentSignature(policies: CmsPolicyDocument[]) {
  return JSON.stringify(policies.map((policy) => ({
    id: policy.id,
    blocks: policy.blocks
  })));
}

export async function GET() {
  const content = await readSiteContent();
  return NextResponse.json({ policies: content.policies || defaultSiteContent.policies }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const current = await readSiteContent();
    const policies = normalizePolicies(body?.policies);
    await writeSiteContentFromAdmin({ ...current, policies });
    const persisted = await readSiteContent();
    const persistedPolicies = persisted.policies || [];
    if (policyContentSignature(persistedPolicies) !== policyContentSignature(policies)) {
      throw new Error("Nội dung chính sách chưa được ghi cố định. Vui lòng bấm lưu lại.");
    }
    return NextResponse.json(
      { policies: persistedPolicies, savedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } }
    );
  } catch (error) {
    return jsonError(error);
  }
}