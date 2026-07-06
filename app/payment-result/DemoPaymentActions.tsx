"use client";

import { useState } from "react";

export function DemoPaymentActions({ orderCode }: { orderCode: string }) {
  const [loading, setLoading] = useState("");

  async function mark(status: "paid" | "failed") {
    setLoading(status);
    await fetch("/api/payments/demo-complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderCode, status })
    });
    window.location.href = `/payment-result?orderCode=${orderCode}&demo=1`;
  }

  return (
    <div className="mt-4 flex flex-wrap gap-3">
      <button onClick={() => mark("paid")} disabled={Boolean(loading)} className="h-10 border border-black bg-black px-4 text-xs uppercase text-white disabled:opacity-50">
        {loading === "paid" ? "Đang cập nhật..." : "Giả lập thành công"}
      </button>
      <button onClick={() => mark("failed")} disabled={Boolean(loading)} className="h-10 border border-black px-4 text-xs uppercase disabled:opacity-50">
        {loading === "failed" ? "Đang cập nhật..." : "Giả lập thất bại"}
      </button>
    </div>
  );
}
