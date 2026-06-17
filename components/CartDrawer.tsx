"use client";

import { Minus, Plus, ShoppingBag, X } from "lucide-react";
import { motion } from "framer-motion";
import { CartItem, Combo } from "@/lib/types";
import { checkoutTotals, money } from "@/lib/pricing";
import { VoucherEngine } from "./VoucherEngine";
import { ComboSuggestion } from "./ComboSuggestion";

export function CartDrawer({
  open,
  items,
  onClose,
  onQty,
  onCheckout,
  onAddCombo
}: {
  open: boolean;
  items: CartItem[];
  onClose: () => void;
  onQty: (index: number, delta: number) => void;
  onCheckout: () => void;
  onAddCombo: (combo: Combo) => void;
}) {
  if (!open) return null;
  const totals = checkoutTotals(items);
  return (
    <motion.div className="fixed inset-0 z-50 bg-black/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.aside initial={{ x: "100%" }} animate={{ x: 0 }} transition={{ type: "spring", damping: 32, stiffness: 260 }} className="ml-auto flex h-full w-full max-w-xl flex-col bg-[#f8f8f7]">
        <div className="flex items-center justify-between border-b border-neutral-200 p-4">
          <div className="flex items-center gap-2"><ShoppingBag size={18} /><span className="text-sm uppercase tracking-[0.14em]">Giỏ hàng</span></div>
          <button onClick={onClose} className="grid h-10 w-10 place-items-center border border-neutral-200 bg-white"><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-6 overflow-auto p-4">
          {items.length === 0 ? <p className="py-16 text-center text-neutral-500">Giỏ đang trống.</p> : items.map((item, index) => (
            <div key={`${item.product.id}-${item.color.name}-${item.size}-${index}`} className="flex gap-3">
              <img src={item.product.image} alt={item.product.name} className="h-28 w-24 object-cover" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium uppercase tracking-[0.08em]">{item.product.name}</h3>
                <p className="mt-1 text-xs text-neutral-500">{item.color.name} · {item.size}</p>
                <p className="mt-2 text-sm">{money(item.product.price)}</p>
              </div>
              <div className="flex h-9 items-center border border-neutral-200 bg-white">
                <button onClick={() => onQty(index, -1)} className="grid h-9 w-9 place-items-center"><Minus size={14} /></button>
                <span className="w-7 text-center text-sm">{item.quantity}</span>
                <button onClick={() => onQty(index, 1)} className="grid h-9 w-9 place-items-center"><Plus size={14} /></button>
              </div>
            </div>
          ))}
          <VoucherEngine items={items} />
          <ComboSuggestion onAddCombo={onAddCombo} compact />
        </div>
        <div className="border-t border-neutral-200 bg-white p-4">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Tạm tính</span><span>{money(totals.subtotal)}</span></div>
            <div className="flex justify-between text-neutral-500"><span>Giảm giá</span><span>-{money(totals.discount)}</span></div>
            <div className="flex justify-between text-neutral-500"><span>Ship</span><span>{money(totals.shipping)}</span></div>
            <div className="flex justify-between border-t border-neutral-200 pt-3 text-lg"><span>Tổng</span><span>{money(totals.total)}</span></div>
          </div>
          <button onClick={onCheckout} className="mt-4 h-12 w-full bg-black text-sm uppercase tracking-[0.14em] text-white">Thanh toán một trang</button>
        </div>
      </motion.aside>
    </motion.div>
  );
}
