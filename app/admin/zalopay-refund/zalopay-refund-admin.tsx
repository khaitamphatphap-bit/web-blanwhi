"use client";

import { FormEvent, useState } from "react";

type RefundAudit = {
  status: "pending" | "succeeded" | "failed" | "blocked";
  amount: number;
  mRefundId?: string;
  refundId?: string;
  message: string;
  updatedAt: string;
};

type LookupResult = {
  ok: boolean;
  payment: {
    appTransId: string;
    zpTransId: string;
    amount: number;
    paidAt?: string;
    refundStatus: number;
  };
  refund: RefundAudit | null;
  refundable: boolean;
  lockReason?: string;
  confirmationToken?: string;
};

function money(value: number) {
  return `${Math.max(0, Number(value) || 0).toLocaleString("vi-VN")} đ`;
}

function refundLabel(status?: RefundAudit["status"]) {
  if (status === "succeeded") return "Đã hoàn tiền";
  if (status === "pending") return "ZaloPay đang xử lý";
  if (status === "failed") return "Hoàn tiền thất bại";
  if (status === "blocked") return "Đã khóa hoàn tiền";
  return "Chưa hoàn tiền";
}

async function responseJson(response: Response) {
  const data = await response.json().catch(() => ({})) as { error?: string; message?: string };
  if (!response.ok) throw new Error(data.error || data.message || "Không thực hiện được yêu cầu. Vui lòng thử lại.");
  return data;
}

export function ZaloPayRefundAdmin() {
  const [appTransId, setAppTransId] = useState("");
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function lookupPayment(event?: FormEvent) {
    event?.preventDefault();
    const normalized = appTransId.trim();
    if (!normalized) {
      setMessage("Vui lòng nhập app_trans_id ZaloPay.");
      return;
    }
    setBusy(true);
    setMessage("");
    setLookup(null);
    setConfirming(false);
    try {
      const response = await fetch(`/api/admin/zalopay/orphan-refund?appTransId=${encodeURIComponent(normalized)}`, {
        cache: "no-store",
        credentials: "same-origin"
      });
      const data = await responseJson(response) as LookupResult;
      setLookup(data);
      setAppTransId(data.payment.appTransId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không tra cứu được giao dịch ZaloPay.");
    } finally {
      setBusy(false);
    }
  }

  async function submitRefund() {
    if (!lookup?.refundable || !lookup.confirmationToken) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/zalopay/orphan-refund", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appTransId: lookup.payment.appTransId,
          expectedAmount: lookup.payment.amount,
          confirmationToken: lookup.confirmationToken
        })
      });
      const result = await response.json().catch(() => ({})) as {
        error?: string;
        message?: string;
        alreadyRefunded?: boolean;
        processing?: boolean;
        locked?: boolean;
        refund?: RefundAudit;
      };
      if (result.locked) {
        setLookup((current) => current ? {
          ...current,
          refund: result.refund || current.refund,
          refundable: false,
          confirmationToken: undefined,
          lockReason: result.message || result.error || "Giao dịch đã được khóa hoàn tiền."
        } : current);
      }
      if (!response.ok) throw new Error(result.error || result.message || "ZaloPay chưa chấp nhận yêu cầu hoàn tiền.");
      setMessage(result.message || (result.alreadyRefunded ? "ZaloPay xác nhận giao dịch đã hoàn tiền." : "Đã gửi yêu cầu hoàn tiền tới ZaloPay."));
      setConfirming(false);
      setLookup((current) => current ? {
        ...current,
        refund: result.refund || current.refund,
        refundable: false,
        confirmationToken: undefined,
        lockReason: result.message || "Lệnh hoàn tiền đã được ghi nhận và khóa gửi lần hai."
      } : current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không gửi được yêu cầu hoàn tiền.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 border border-neutral-300 p-5 md:p-7">
      <form onSubmit={lookupPayment} className="grid gap-3 md:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold">Mã giao dịch ZaloPay (app_trans_id)</span>
          <input
            value={appTransId}
            onChange={(event) => setAppTransId(event.target.value)}
            placeholder="Ví dụ: 260901_BLW-260901..."
            autoCapitalize="characters"
            spellCheck={false}
            className="h-12 w-full border border-neutral-300 px-4 text-sm outline-none focus:border-black"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="h-12 self-end border border-black bg-black px-6 text-sm font-semibold uppercase text-white disabled:opacity-50"
        >
          {busy ? "Đang kiểm tra..." : "Tra cứu ZaloPay"}
        </button>
      </form>

      {message && <p className="mt-4 border border-neutral-300 bg-neutral-50 p-4 text-sm">{message}</p>}

      {lookup && (
        <div className="mt-6 border-t border-neutral-200 pt-6">
          <div className="grid gap-4 text-sm md:grid-cols-2">
            <div>
              <p className="text-xs uppercase text-neutral-500">Mã giao dịch website</p>
              <strong className="mt-1 block break-all">{lookup.payment.appTransId}</strong>
            </div>
            <div>
              <p className="text-xs uppercase text-neutral-500">Mã giao dịch ZaloPay</p>
              <strong className="mt-1 block break-all">{lookup.payment.zpTransId}</strong>
            </div>
            <div>
              <p className="text-xs uppercase text-neutral-500">Thanh toán</p>
              <strong className="mt-1 block text-emerald-700">ZaloPay xác nhận đã thanh toán</strong>
            </div>
            <div>
              <p className="text-xs uppercase text-neutral-500">Số tiền được phép hoàn</p>
              <strong className="mt-1 block text-2xl">{money(lookup.payment.amount)}</strong>
            </div>
            <div>
              <p className="text-xs uppercase text-neutral-500">Trạng thái hoàn tiền</p>
              <strong className="mt-1 block">{refundLabel(lookup.refund?.status)}</strong>
            </div>
            <div>
              <p className="text-xs uppercase text-neutral-500">Cập nhật</p>
              <strong className="mt-1 block">
                {lookup.refund?.updatedAt ? new Date(lookup.refund.updatedAt).toLocaleString("vi-VN") : "Vừa tra cứu trực tiếp"}
              </strong>
            </div>
          </div>

          {(lookup.lockReason || lookup.refund?.message) && (
            <p className={`mt-5 border p-4 text-sm ${lookup.refund?.status === "succeeded" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
              {lookup.lockReason || lookup.refund?.message}
            </p>
          )}

          {lookup.refundable && !confirming && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy}
              className="mt-6 h-12 border border-red-700 px-5 text-sm font-semibold uppercase text-red-700 disabled:opacity-50"
            >
              Xác nhận hoàn {money(lookup.payment.amount)}
            </button>
          )}

          {lookup.refundable && confirming && (
            <div className="mt-6 border border-red-300 bg-red-50 p-5">
              <p className="font-semibold text-red-900">Bạn có chắc chắn muốn hoàn toàn bộ {money(lookup.payment.amount)} cho giao dịch này?</p>
              <p className="mt-2 text-sm text-red-800">Sau khi gửi, hệ thống sẽ khóa giao dịch để không thể hoàn lần thứ hai.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={submitRefund}
                  disabled={busy}
                  className="h-11 border border-red-700 bg-red-700 px-5 text-sm font-semibold uppercase text-white disabled:opacity-50"
                >
                  {busy ? "Đang gửi ZaloPay..." : "Đồng ý hoàn tiền"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="h-11 border border-neutral-400 bg-white px-5 text-sm uppercase disabled:opacity-50"
                >
                  Không hoàn
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
