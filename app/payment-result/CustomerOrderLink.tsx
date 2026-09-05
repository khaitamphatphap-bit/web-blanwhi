"use client";

import { useState } from "react";

export function CustomerOrderLink() {
  const [message, setMessage] = useState("");

  async function copyOrderLink() {
    try {
      const response = await fetch("/api/customer/session", { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.claimUrl) throw new Error("Không tạo được link xem đơn.");
      await navigator.clipboard.writeText(result.claimUrl);
      setMessage("Đã sao chép link xem đơn.");
    } catch {
      setMessage("Chưa sao chép được. Vui lòng thử lại.");
    }
  }

  return (
    <div className="mt-6 border-t border-neutral-200 pt-5">
      <button type="button" onClick={copyOrderLink} className="h-11 border border-black px-5 text-sm uppercase">
        Sao chép link xem đơn
      </button>
      <p className="mt-2 text-xs leading-5 text-neutral-500">(Nếu bạn cần xem đơn ở thiết bị khác hoặc trình duyệt khác)</p>
      {message && <p className="mt-2 text-xs text-neutral-700" role="status">{message}</p>}
    </div>
  );
}
