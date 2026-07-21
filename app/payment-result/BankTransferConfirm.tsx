"use client";

import Link from "next/link";
import { useState } from "react";

export function BankTransferConfirm({ orderCode }: { orderCode: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function confirmTransfer() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/payments/bank-transfer-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderCode })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không xác nhận được chuyển khoản.");
      window.location.href = `/payment-result?provider=bank_transfer&orderCode=${orderCode}&bankConfirmed=1`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xác nhận được chuyển khoản.");
      setLoading(false);
    }
  }

  return (
    <div className="mt-6 border border-black p-5">
      <p className="text-sm leading-6 text-neutral-600">
        Sau khi đã chuyển khoản đúng số tiền và nội dung đơn hàng, bấm xác nhận để đơn chuyển sang trạng thái đã thanh toán.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button onClick={confirmTransfer} disabled={loading} className="h-11 bg-black px-5 text-xs uppercase text-white disabled:opacity-50">
          {loading ? "Đang xác nhận..." : "Tôi đã chuyển khoản"}
        </button>
        <Link href={`/?orderCode=${orderCode}#orders`} className="inline-flex h-11 items-center border border-black px-5 text-xs uppercase">
          Xem trạng thái đơn
        </Link>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
