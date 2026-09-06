import crypto from "crypto";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import {
  hasDatabase,
  readKeyedJsonStore,
  withDataStoreLock,
  writeKeyedJsonRecord
} from "@/lib/data-store";
import { readIntegrationConfig } from "@/lib/integrations";
import {
  queryZaloPayPayment,
  queryZaloPayRefund,
  refundZaloPayPayment,
  zaloPayRefundRequestId
} from "@/lib/payment";
import type { ShopOrder } from "@/lib/types";

type OrphanRefundAudit = {
  appTransId: string;
  zpTransId: string;
  amount: number;
  mRefundId?: string;
  status: "pending" | "succeeded" | "failed" | "blocked";
  message: string;
  refundId?: string;
  createdAt: string;
  updatedAt: string;
};

const auditNamespace = "zalopay-orphan-refunds";
const confirmationLifetimeMs = 5 * 60_000;

function httpError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function normalizeAppTransId(value: unknown) {
  const appTransId = String(value || "").trim();
  if (!/^\d{6}_[A-Za-z0-9_-]{1,33}$/.test(appTransId)) {
    throw httpError("Mã giao dịch phải là app_trans_id ZaloPay, ví dụ 260901_BLW-...", 400);
  }
  return appTransId;
}

function assertSameOrigin(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    throw httpError("Yêu cầu hoàn tiền phải được thực hiện trực tiếp từ trang admin BLANWHI.", 403);
  }
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    throw httpError("Nguồn gửi yêu cầu hoàn tiền không hợp lệ.", 403);
  }
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
  const config = await readIntegrationConfig();
  const payment = await queryZaloPayPayment(orphanOrder(appTransId), config.payment);
  if (Number(payment.return_code || 0) !== 1 || !payment.zp_trans_id || !Number(payment.amount || 0)) {
    throw httpError(
      payment.sub_return_message || payment.return_message || "ZaloPay chưa xác nhận giao dịch này đã thanh toán thành công.",
      409
    );
  }
  return {
    config,
    payment,
    amount: Math.floor(Number(payment.amount)),
    zpTransId: String(payment.zp_trans_id)
  };
}

function confirmationSecret(config: Awaited<ReturnType<typeof readIntegrationConfig>>) {
  const secret = String(config.payment.zalopay.key1 || process.env.ZALOPAY_KEY1 || "").trim();
  if (!secret) throw httpError("Thiếu Key 1 ZaloPay production để xác nhận hoàn tiền.", 503);
  return secret;
}

function createConfirmationToken(
  appTransId: string,
  zpTransId: string,
  amount: number,
  config: Awaited<ReturnType<typeof readIntegrationConfig>>
) {
  const expiresAt = Date.now() + confirmationLifetimeMs;
  const payload = `${appTransId}|${zpTransId}|${amount}|${expiresAt}`;
  const signature = crypto.createHmac("sha256", confirmationSecret(config)).update(payload).digest("hex");
  return `${expiresAt}.${signature}`;
}

function verifyConfirmationToken(
  token: string,
  appTransId: string,
  zpTransId: string,
  amount: number,
  config: Awaited<ReturnType<typeof readIntegrationConfig>>
) {
  const [expiresText, received] = String(token || "").split(".");
  const expiresAt = Number(expiresText);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !/^[a-f0-9]{64}$/.test(received || "")) {
    throw httpError("Phiên xác nhận đã hết hạn. Vui lòng tra cứu lại giao dịch trước khi hoàn tiền.", 409);
  }
  const payload = `${appTransId}|${zpTransId}|${amount}|${expiresAt}`;
  const expected = crypto.createHmac("sha256", confirmationSecret(config)).update(payload).digest("hex");
  const valid = crypto.timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
  if (!valid) throw httpError("Thông tin xác nhận hoàn tiền không hợp lệ. Vui lòng tra cứu lại.", 409);
}

async function saveAudit(audit: OrphanRefundAudit) {
  await writeKeyedJsonRecord(auditNamespace, audit.appTransId, audit);
  return audit;
}

async function auditFromZaloPayStatus(
  appTransId: string,
  zpTransId: string,
  amount: number,
  existing: OrphanRefundAudit | undefined,
  paymentRefundStatus: number
) {
  if (paymentRefundStatus === 1) {
    if (existing?.status === "succeeded") return existing;
    const now = new Date().toISOString();
    return saveAudit({
      appTransId,
      zpTransId,
      amount,
      mRefundId: existing?.mRefundId,
      status: "succeeded",
      message: "ZaloPay xác nhận giao dịch đã được hoàn tiền. Hệ thống đã khóa hoàn lần nữa.",
      refundId: existing?.refundId,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });
  }
  if (paymentRefundStatus === 4) {
    if (existing?.status === "blocked") return existing;
    const now = new Date().toISOString();
    return saveAudit({
      appTransId,
      zpTransId,
      amount,
      mRefundId: existing?.mRefundId,
      status: "blocked",
      message: "ZaloPay báo giao dịch đã được hoàn một phần. Công cụ khóa hoàn tự động để tránh hoàn vượt số tiền.",
      refundId: existing?.refundId,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });
  }
  return existing || null;
}

async function reconcileExistingAudit(
  audit: OrphanRefundAudit | null,
  config: Awaited<ReturnType<typeof readIntegrationConfig>>
) {
  if (!audit?.mRefundId || audit.status === "succeeded" || audit.status === "blocked") return audit;
  try {
    const result = await queryZaloPayRefund(audit.mRefundId, config.payment);
    const refundStatus = Number(result.refund_status || 0);
    if (refundStatus === 1) {
      return saveAudit({
        ...audit,
        status: "succeeded",
        refundId: result.refund_id ? String(result.refund_id) : audit.refundId,
        message: "ZaloPay xác nhận đã hoàn tiền. Hệ thống đã khóa hoàn lần nữa.",
        updatedAt: new Date().toISOString()
      });
    }
    if (refundStatus === 2) {
      return saveAudit({
        ...audit,
        status: "failed",
        message: result.sub_return_message || result.return_message || "ZaloPay xác nhận lần hoàn tiền trước đã thất bại.",
        updatedAt: new Date().toISOString()
      });
    }
    if (refundStatus === 3) {
      return saveAudit({
        ...audit,
        status: "pending",
        message: result.sub_return_message || result.return_message || "ZaloPay đang xử lý hoàn tiền.",
        updatedAt: new Date().toISOString()
      });
    }
  } catch {
    // Không gửi lại lệnh khi chưa xác định được kết quả của mã hoàn cũ.
  }
  return audit;
}

function lockedReason(audit: OrphanRefundAudit | null) {
  if (audit?.status === "succeeded") return "Giao dịch này đã hoàn tiền và đã được khóa hoàn lần nữa.";
  if (audit?.status === "pending") return "Lệnh hoàn tiền đã được gửi và đang xử lý. Hệ thống sẽ không gửi lệnh thứ hai.";
  if (audit?.status === "blocked") return audit.message;
  if (audit?.status === "failed" && audit.mRefundId) {
    return "Lần hoàn trước đã có mã yêu cầu nhưng ZaloPay báo thất bại. Công cụ khóa gửi lại để tránh hoàn trùng; cần đối chiếu ZaloPay trước.";
  }
  return "";
}

export async function GET(request: Request) {
  try {
    if (!hasDatabase()) throw httpError("Database chưa sẵn sàng nên công cụ hoàn tiền đã được khóa để bảo vệ giao dịch.", 503);
    const appTransId = normalizeAppTransId(new URL(request.url).searchParams.get("appTransId"));
    const { config, payment, amount, zpTransId } = await verifiedPayment(appTransId);
    const audits = await readKeyedJsonStore<OrphanRefundAudit>(auditNamespace, {});
    let refund = await auditFromZaloPayStatus(appTransId, zpTransId, amount, audits[appTransId], Number(payment.refund_status || 0));
    refund = await reconcileExistingAudit(refund, config);
    const reason = lockedReason(refund);
    return NextResponse.json({
      ok: true,
      payment: {
        appTransId,
        zpTransId,
        amount,
        returnCode: payment.return_code,
        message: payment.return_message,
        paidAt: payment.server_time ? new Date(Number(payment.server_time)).toISOString() : undefined,
        refundStatus: Number(payment.refund_status || 0)
      },
      refund,
      refundable: !reason,
      lockReason: reason || undefined,
      confirmationToken: reason ? undefined : createConfirmationToken(appTransId, zpTransId, amount, config)
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!hasDatabase()) throw httpError("Database chưa sẵn sàng nên chưa thể gửi lệnh hoàn tiền an toàn.", 503);
    const body = await request.json() as {
      appTransId?: unknown;
      expectedAmount?: unknown;
      confirmationToken?: unknown;
    };
    const appTransId = normalizeAppTransId(body.appTransId);
    const expectedAmount = Math.floor(Number(body.expectedAmount));
    const token = String(body.confirmationToken || "");

    return withDataStoreLock(`zalopay-orphan-refund:${appTransId}`, async () => {
      const { config, payment, amount, zpTransId } = await verifiedPayment(appTransId);
      if (!Number.isFinite(expectedAmount) || expectedAmount !== amount) {
        throw httpError("Số tiền xác nhận không khớp với ZaloPay. Chưa gửi lệnh hoàn tiền.", 409);
      }
      verifyConfirmationToken(token, appTransId, zpTransId, amount, config);

      const audits = await readKeyedJsonStore<OrphanRefundAudit>(auditNamespace, {});
      let existing = await auditFromZaloPayStatus(appTransId, zpTransId, amount, audits[appTransId], Number(payment.refund_status || 0));
      existing = await reconcileExistingAudit(existing, config);
      const reason = lockedReason(existing);
      if (reason) {
        return NextResponse.json({
          ok: existing?.status === "succeeded",
          alreadyRefunded: existing?.status === "succeeded",
          processing: existing?.status === "pending",
          locked: true,
          message: reason,
          refund: existing
        }, { status: existing?.status === "succeeded" || existing?.status === "pending" ? 200 : 409 });
      }

      const now = new Date().toISOString();
      const draftOrder = orphanOrder(appTransId, amount, zpTransId);
      const mRefundId = zaloPayRefundRequestId(draftOrder, config.payment);
      let refund: OrphanRefundAudit = await saveAudit({
        appTransId,
        zpTransId,
        amount,
        mRefundId,
        status: "pending",
        message: "Đã khóa giao dịch và đang gửi yêu cầu hoàn tiền tới ZaloPay.",
        createdAt: now,
        updatedAt: now
      });

      try {
        const result = await refundZaloPayPayment(
          { ...draftOrder, refundTransactionId: mRefundId },
          config.payment,
          `Hoan tien giao dich that lac ${appTransId}`
        );
        const accepted = Number(result.return_code || 0) === 1 || Number(result.return_code || 0) === 3;
        refund = await saveAudit({
          ...refund,
          status: accepted ? "pending" : "failed",
          refundId: result.refund_id ? String(result.refund_id) : undefined,
          message: result.sub_return_message || result.return_message || (accepted ? "ZaloPay đang xử lý hoàn tiền." : "ZaloPay từ chối yêu cầu hoàn tiền."),
          updatedAt: new Date().toISOString()
        });
        if (!accepted) {
          return NextResponse.json({ ok: false, locked: true, message: refund.message, refund }, { status: 409 });
        }
      } catch (error) {
        refund = await saveAudit({
          ...refund,
          status: "pending",
          message: `${error instanceof Error ? error.message : "Chưa nhận được phản hồi ZaloPay."} Hệ thống đã khóa gửi lại để tránh hoàn trùng; hãy bấm kiểm tra lại.`,
          updatedAt: new Date().toISOString()
        });
        return NextResponse.json({ ok: true, processing: true, locked: true, message: refund.message, refund }, { status: 202 });
      }

      refund = await reconcileExistingAudit(refund, config) || refund;
      return NextResponse.json({
        ok: true,
        processing: refund.status === "pending",
        alreadyRefunded: refund.status === "succeeded",
        locked: true,
        message: refund.message,
        payment: { appTransId, zpTransId, amount },
        refund
      });
    });
  } catch (error) {
    return jsonError(error);
  }
}
