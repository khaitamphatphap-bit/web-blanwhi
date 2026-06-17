"use client";

import { estimateCustomPrice, money } from "@/lib/pricing";

export function PriceEstimator({ quantity, positions, printSize, printType }: { quantity: number; positions: number; printSize: number; printType: string }) {
  const estimate = estimateCustomPrice(quantity, positions, printSize, printType);
  return (
    <div className="bg-black p-5 text-white">
      <p className="text-xs uppercase tracking-[0.16em] text-white/50">Báo giá realtime</p>
      <div className="mt-4 space-y-3">
        <div className="flex justify-between"><span>Tổng tiền</span><strong>{money(estimate.total)}</strong></div>
        <div className="flex justify-between text-white/70"><span>Đặt cọc 40%</span><span>{money(estimate.deposit)}</span></div>
        <div className="flex justify-between text-white/70"><span>Dự kiến giao</span><span>{estimate.days} ngày</span></div>
      </div>
    </div>
  );
}
