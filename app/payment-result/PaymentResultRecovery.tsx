"use client";

import { useEffect, useState } from "react";

type PaymentResultRecoveryProps = {
  orderCode: string;
  shouldRecover: boolean;
};

function readStoredOrders(key: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function PaymentResultRecovery({ orderCode, shouldRecover }: PaymentResultRecoveryProps) {
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!shouldRecover || !orderCode) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("recovered") === "1") return;

    const normalizedCode = orderCode.trim().toUpperCase();
    const localOrder = [...readStoredOrders("blanwhiOrders"), ...readStoredOrders("blanwhiOrdersBackup")]
      .find((order) => String(order?.code || "").trim().toUpperCase() === normalizedCode);
    if (!localOrder) return;

    let cancelled = false;
    setMessage("Đang khôi phục đơn hàng vừa thanh toán...");
    fetch("/api/orders/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(localOrder)
    })
      .then((response) => {
        if (!response.ok) throw new Error("recover failed");
        if (cancelled) return;
        url.searchParams.set("recovered", "1");
        window.location.replace(url.toString());
      })
      .catch(() => {
        if (!cancelled) setMessage("");
      });

    return () => {
      cancelled = true;
    };
  }, [orderCode, shouldRecover]);

  if (!message) return null;
  return (
    <div className="mt-6 border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
      {message}
    </div>
  );
}
