"use client";

import { CartItem, Combo } from "@/lib/types";
import { checkoutTotals, money } from "@/lib/pricing";
import { VoucherEngine } from "./VoucherEngine";
import { ComboSuggestion } from "./ComboSuggestion";

export function CheckoutForm({ items, onAddCombo }: { items: CartItem[]; onAddCombo: (combo: Combo) => void }) {
  const totals = checkoutTotals(items);
  return (
    <section id="checkout" className="grid gap-8 py-14 lg:grid-cols-[1.1fr_.9fr]">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-neutral-500">One-page checkout</p>
        <h2 className="mt-2 text-3xl font-medium">Thanh toán không chia bước.</h2>
        <div className="mt-6 grid gap-4 bg-white p-5 shadow-soft">
          <input className="h-12 border border-neutral-200 px-3" placeholder="Họ tên" />
          <input className="h-12 border border-neutral-200 px-3" placeholder="Số điện thoại" />
          <input className="h-12 border border-neutral-200 px-3" placeholder="Địa chỉ giao hàng" />
          <textarea className="min-h-24 border border-neutral-200 p-3" placeholder="Ghi chú giao hàng" />
          <div className="grid gap-2 sm:grid-cols-4">
            {["COD", "Thẻ", "Chuyển khoản", "Ví điện tử"].map((method) => (
              <label key={method} className="flex h-12 items-center justify-center border border-neutral-200 text-sm">
                <input name="pay" type="radio" className="mr-2" defaultChecked={method === "COD"} />
                {method}
              </label>
            ))}
          </div>
          <button className="h-12 bg-black text-sm uppercase tracking-[0.14em] text-white">Đặt hàng</button>
        </div>
      </div>
      <aside className="space-y-5">
        <div className="bg-white p-5 shadow-soft">
          <h3 className="text-sm font-medium uppercase tracking-[0.12em]">Đơn hàng</h3>
          <div className="mt-4 space-y-3">
            {items.length === 0 ? <p className="text-sm text-neutral-500">Chưa có sản phẩm. Hãy thêm nhanh từ danh sách.</p> : items.map((item, index) => (
              <div key={index} className="flex justify-between gap-4 text-sm">
                <span>{item.quantity}x {item.product.name} · {item.color.name} · {item.size}</span>
                <span>{money(item.product.price * item.quantity)}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 space-y-2 border-t border-neutral-200 pt-4 text-sm">
            <div className="flex justify-between"><span>Tạm tính</span><span>{money(totals.subtotal)}</span></div>
            <div className="flex justify-between text-neutral-500"><span>{totals.voucher?.title ?? "Voucher"}</span><span>-{money(totals.discount)}</span></div>
            <div className="flex justify-between text-neutral-500"><span>Ship</span><span>{money(totals.shipping)}</span></div>
            <div className="flex justify-between pt-2 text-xl"><span>Cần trả</span><span>{money(totals.total)}</span></div>
          </div>
        </div>
        <VoucherEngine items={items} />
        <ComboSuggestion onAddCombo={onAddCombo} compact />
      </aside>
    </section>
  );
}
