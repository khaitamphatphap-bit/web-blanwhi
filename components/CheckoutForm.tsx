"use client";

import { CartItem, Combo } from "@/lib/types";
import { checkoutTotals, money } from "@/lib/pricing";
import { VoucherEngine } from "./VoucherEngine";
import { ComboSuggestion } from "./ComboSuggestion";
import { FormEvent, useState } from "react";

const paymentMethods = [
  { value: "cod", label: "COD" },
  { value: "vnpay", label: "Thẻ VNPAY" },
  { value: "onepay", label: "OnePay" },
  { value: "alepay", label: "AlePay" },
  { value: "momo", label: "MoMo" },
  { value: "bank_transfer", label: "Chuyển khoản" }
] as const;

export function CheckoutForm({ items, onAddCombo }: { items: CartItem[]; onAddCombo: (combo: Combo) => void }) {
  const totals = checkoutTotals(items);
  const [paymentMethod, setPaymentMethod] = useState<(typeof paymentMethods)[number]["value"]>("cod");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod,
          customer: {
            name: form.get("name"),
            phone: form.get("phone"),
            address: form.get("address"),
            note: form.get("note")
          },
          items
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Không thể tạo giao dịch.");
      window.location.href = result.redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tạo giao dịch.");
      setSubmitting(false);
    }
  }

  return (
    <section id="checkout" className="grid gap-8 py-14 lg:grid-cols-[1.1fr_.9fr]">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-neutral-500">One-page checkout</p>
        <h2 className="mt-2 text-3xl font-medium">Thanh toán không chia bước.</h2>
        <form onSubmit={submitOrder} className="mt-6 grid gap-4 bg-white p-5 shadow-soft">
          <input name="name" required className="h-12 border border-neutral-200 px-3" placeholder="Họ tên" />
          <input name="phone" required className="h-12 border border-neutral-200 px-3" placeholder="Số điện thoại" />
          <input name="address" required className="h-12 border border-neutral-200 px-3" placeholder="Địa chỉ giao hàng" />
          <textarea name="note" className="min-h-24 border border-neutral-200 p-3" placeholder="Ghi chú giao hàng" />
          <div className="grid gap-2 sm:grid-cols-3">
            {paymentMethods.map((method) => (
              <label key={method.value} className={`flex min-h-12 items-center justify-center border px-2 text-center text-sm ${paymentMethod === method.value ? "border-black bg-black text-white" : "border-neutral-200 bg-white"}`}>
                <input
                  name="pay"
                  type="radio"
                  className="mr-2"
                  checked={paymentMethod === method.value}
                  onChange={() => setPaymentMethod(method.value)}
                />
                {method.label}
              </label>
            ))}
          </div>
          <p className="text-xs leading-5 text-neutral-500">
            Thẻ/Ví sẽ chuyển khách sang cổng thanh toán. Website chỉ nhận kết quả qua Return URL và IPN, không lưu số thẻ của khách.
          </p>
          {error && <p className="border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <button disabled={submitting || items.length === 0} className="h-12 bg-black text-sm uppercase tracking-[0.14em] text-white disabled:cursor-not-allowed disabled:bg-neutral-300">
            {submitting ? "Đang tạo giao dịch..." : "Đặt hàng"}
          </button>
        </form>
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
