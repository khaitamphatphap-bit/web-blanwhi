"use client";

import { useEffect, useState } from "react";

export function PaymentStatusWatcher({ orderCode }: { orderCode: string }) {
  const [message, setMessage] = useState("Đang chờ ngân hàng xác nhận...");

  useEffect(() => {
    let stopped = false;
    let attempts = 0;
    const check = async () => {
      try {
        const response = await fetch(`/api/orders?codes=${encodeURIComponent(orderCode)}&paymentCheck=1`, { cache: "no-store" });
        const result = await response.json() as { orders?: Array<{ status?: string }> };
        const status = result.orders?.[0]?.status;
        if (status === "paid" || status === "failed" || status === "cancelled") {
          window.location.reload();
          return;
        }
      } catch {
        setMessage("Đang kết nối lại với hệ thống xác nhận thanh toán...");
      }
      attempts += 1;
      if (!stopped && attempts < 90) window.setTimeout(check, 2000);
      else if (!stopped) setMessage("Chưa nhận được xác nhận. Vui lòng tải lại trang sau ít phút.");
    };
    void check();
    return () => { stopped = true; };
  }, [orderCode]);

  return <p className="mt-3 text-sm font-medium">{message}</p>;
}
