import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { readKeyedJsonStore, writeKeyedJsonRecord } from "@/lib/data-store";
import { readIntegrationConfig } from "@/lib/integrations";
import { queryZaloPayPayment, queryZaloPayRefund, refundZaloPayPayment, zaloPayRefundRequestId } from "@/lib/payment";
import type { ShopOrder } from "@/lib/types";

type OrphanRefundAudit = {
  appTransId: string;
  zpTransId: string;
  amount: number;
  mRefundId: string;
  status: "pending" | "succeeded" | "failed";
  message: string;
  refundId?: string;
  createdAt: string;
  updatedAt: string;
};

const auditNamespace = "zalopay-orphan-refunds";

function normalizeAppTransId(value: unknown) {
  return String(value || "").trim();
}

function orphanOrder(appTransId: string, amount = 0, zpTransId = "", mRefundId = ""): ShopOrder {
  const now = new Date().toISOString();
  const code = appTransId.includes("_") ? appTransId.slice(appTransId.indexOf("_") + 1) : appTransId;
  return {
    id: `orphan-zalopay-${appTransId}`,
    code,
    status: "cancelled",
    paymentMethod: "zalopay",
    paymentProvider: "zalopay",
    paymentProviderOrderId: appTransId,
    transactionId: zpTransId || undefined,
    refundTransactionId: mRefundId || undefined,
    customer: { name: "Giao dịch ZaloPay thất lạc", phone: "", address: "" },
    items: [],
    subtotal: amount,
    discount: 0,
    shipping: 0,
    total: amount,
    createdAt: now,
    updatedAt: now
  };
}

async function verifiedPayment(appTransId: string) {
  if (!/^\d{6}_.+/.test(appTransId)) throw new Error("Mã app_trans_id ZaloPay không hợp lệ.");
  const config = await readIntegrationConfig();
  const payment = await queryZaloPayPayment(orphanOrder(appTransId), config.payment);
  if (Number(payment.return_code || 0) !== 1 || !payment.zp_trans_id || !Number(payment.amount || 0)) {
    throw new Error(payment.sub_return_message || payment.return_message || "ZaloPay chưa xác nhận giao dịch này đã thanh toán thành công.");
  }
  return { config, payment, amount: Math.floor(Number(payment.amount)), zpTransId: String(payment.zp_trans_id) };
}

export async function GET(request: Request) {
  try {
    const appTransId = normalizeAppTransId(new URL(request.url).searchParams.get("appTransId"));
    const [{ payment, amount, zpTransId }, audits] = await Promise.all([
      verifiedPayment(appTransId),
      readKeyedJsonStore<OrphanRefundAudit>(auditNamespace, {})
    ]);
    return NextResponse.json({
      ok: true,
      payment: {
        appTransId,
        zpTransId,
        amount,
        returnCode: payment.return_code,
        message: payment.return_message,
        paidAt: payment.server_time ? new Date(Number(payment.server_time)).toISOString() : undefined
      },
      refund: audits[appTransId] || null
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await request.json() as { appTransId?: unknown; expectedAmount?: unknown }
      : Object.fromEntries(await request.formData()) as { appTransId?: unknown; expectedAmount?: unknown };
    const appTransId = normalizeAppTransId(body.appTransId);
    const expectedAmount = Math.floor(Number(body.expectedAmount));
    const { config, payment, amount, zpTransId } = await verifiedPayment(appTransId);
    if (!Number.isFinite(expectedAmount) || expectedAmount !== amount) {
      return NextResponse.json({ error: "Số tiền xác nhận không khớp với giao dịch ZaloPay. Chưa gửi lệnh hoàn tiền." }, { status: 409 });
    }

    const audits = await readKeyedJsonStore<OrphanRefundAudit>(auditNamespace, {});
    const existing = audits[appTransId];
    if (existing?.status === "succeeded") {
      return NextResponse.json({ ok: true, alreadyRefunded: true, refund: existing });
    }
    if (existing?.mRefundId) {
      const check = await queryZaloPayRefund(existing.mRefundId, config.payment);
      if (Number(check.refund_status || 0) === 1) {
        const succeeded: OrphanRefundAudit = {
          ...existing,
          status: "succeeded",
          message: check.return_message || "ZaloPay xác nhận đã hoàn tiền.",
          updatedAt: new Date().toISOString()
        };
        await writeKeyedJsonRecord(auditNamespace, appTransId, succeeded);
        return NextResponse.json({ ok: true, alreadyRefunded: true, refund: succeeded });
      }
      if (existing.status === "pending") {
        return NextResponse.json({ ok: true, processing: true, refund: existing });
      }
    }

    const now = new Date().toISOString();
    const draftOrder = orphanOrder(appTransId, amount, zpTransId, existing?.mRefundId);
    const mRefundId = existing?.mRefundId || zaloPayRefundRequestId(draftOrder, config.payment);
    const pending: OrphanRefundAudit = {
      appTransId,
      zpTransId,
      amount,
      mRefundId,
      status: "pending",
      message: "Đã ghi nhận yêu cầu, đang gửi ZaloPay.",
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    await writeKeyedJsonRecord(auditNamespace, appTransId, pending);

    const result = await refundZaloPayPayment(
      { ...draftOrder, refundTransactionId: mRefundId },
      config.payment,
      `Hoan tien giao dich that lac ${appTransId}`
    );
    const accepted = Number(result.return_code || 0) === 1 || Number(result.return_code || 0) === 3;
    const saved: OrphanRefundAudit = {
      ...pending,
      status: accepted ? "pending" : "failed",
      refundId: result.refund_id ? String(result.refund_id) : undefined,
      message: result.sub_return_message || result.return_message || (accepted ? "ZaloPay đang xử lý hoàn tiền." : "ZaloPay từ chối yêu cầu hoàn tiền."),
      updatedAt: new Date().toISOString()
    };
    await writeKeyedJsonRecord(auditNamespace, appTransId, saved);
    return NextResponse.json({ ok: accepted, payment: { ...payment, zp_trans_id: zpTransId, amount }, refund: saved }, { status: accepted ? 200 : 409 });
  } catch (error) {
    return jsonError(error);
  }
}
