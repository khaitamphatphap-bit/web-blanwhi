"use client";

import { getVouchers, money } from "@/lib/pricing";
import { CartItem } from "@/lib/types";

export function VoucherEngine({ items }: { items: CartItem[] }) {
  const vouchers = getVouchers(items);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium uppercase tracking-[0.12em]">Voucher tự động</h3>
        <span className="text-xs text-neutral-500">{money(items.reduce((sum, item) => sum + item.product.price * item.quantity, 0))}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {vouchers.map((voucher) => (
          <div key={voucher.id} className={`border p-3 text-xs ${voucher.unlocked ? "border-black bg-black text-white" : "border-neutral-200 bg-white text-neutral-700"}`}>
            <div className="flex items-center justify-between gap-3">
              <strong className="uppercase tracking-[0.1em]">{voucher.title}</strong>
              <span>{Math.round(voucher.discount * 100)}%</span>
            </div>
            <p className={`mt-1 ${voucher.unlocked ? "text-white/75" : "text-neutral-500"}`}>{voucher.progress}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
