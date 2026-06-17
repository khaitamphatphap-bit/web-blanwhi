"use client";

import { X } from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";
import { money } from "@/lib/pricing";
import { Product, ColorOption, Combo } from "@/lib/types";
import { ColorSwatch } from "./ColorSwatch";
import { ComboSuggestion } from "./ComboSuggestion";

export function ProductDetail({
  product,
  onClose,
  onAdd,
  onBuyNow,
  onAddCombo
}: {
  product: Product;
  onClose: () => void;
  onAdd: (product: Product, color: ColorOption, size: string) => void;
  onBuyNow: (product: Product, color: ColorOption, size: string) => void;
  onAddCombo: (combo: Combo) => void;
}) {
  const [color, setColor] = useState(product.colors[0]);
  const [size, setSize] = useState(product.sizes[1]);
  const [showFabric, setShowFabric] = useState(false);
  const [showRealColor, setShowRealColor] = useState(false);

  return (
    <motion.div className="fixed inset-0 z-40 bg-black/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.aside initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", damping: 30, stiffness: 260 }} className="ml-auto h-full w-full overflow-auto bg-[#f8f8f7] p-4 sm:w-[720px] sm:p-7">
        <div className="mb-5 flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.16em] text-neutral-500">Chi tiết nhanh</p>
          <button onClick={onClose} className="focus-ring grid h-10 w-10 place-items-center border border-neutral-200 bg-white"><X size={18} /></button>
        </div>
        <div className="grid gap-6 md:grid-cols-[1.05fr_.95fr]">
          <img src={product.image} alt={product.name} className="aspect-[4/5] w-full object-cover" />
          <div className="space-y-5">
            <div>
              <h1 className="text-3xl font-medium">{product.name}</h1>
              <p className="mt-2 text-neutral-500">{product.material} · {product.fit}</p>
              <p className="mt-3 text-xl">{money(product.price)}</p>
            </div>
            <div>
              <p className="mb-2 text-sm">Màu: {color.name}</p>
              <ColorSwatch colors={product.colors} value={color} onChange={setColor} />
            </div>
            <div>
              <p className="mb-2 text-sm">Size · còn {product.stock[size]} sản phẩm</p>
              <div className="grid grid-cols-4 gap-2">
                {product.sizes.map((item) => (
                  <button key={item} onClick={() => setSize(item)} className={`h-11 border text-sm ${size === item ? "border-black bg-black text-white" : "border-neutral-200 bg-white"}`}>{item}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => onAdd(product, color, size)} className="h-12 border border-black bg-white text-sm uppercase tracking-[0.12em]">Thêm vào giỏ</button>
              <button onClick={() => onBuyNow(product, color, size)} className="h-12 bg-black text-sm uppercase tracking-[0.12em] text-white">Mua ngay</button>
            </div>
            <div className="space-y-2 border-y border-neutral-200 py-4 text-sm text-neutral-600">
              <p>Voucher phù hợp: đơn từ 500k tự giảm 5%, từ 1 triệu tự giảm 10%.</p>
              <p>Phối màu: {color.tone === "dark" ? "mặc cùng quần xám tro hoặc stone để sáng da." : "đi cùng quần đen hoặc charcoal để outfit sắc hơn."}</p>
            </div>
            <div className="grid gap-2">
              <button onClick={() => setShowFabric(!showFabric)} className="h-11 border border-neutral-200 bg-white text-sm">Bạn có cần xem kỹ chất vải không?</button>
              {showFabric && <video src={product.videoFabric} controls className="aspect-video w-full bg-black" />}
              <button onClick={() => setShowRealColor(!showRealColor)} className="h-11 border border-neutral-200 bg-white text-sm">Bạn có cần xem màu ngoài đời không?</button>
              {showRealColor && <video src={product.videoColor} controls className="aspect-video w-full bg-black" />}
            </div>
          </div>
        </div>
        <div className="mt-8">
          <ComboSuggestion onAddCombo={onAddCombo} compact />
        </div>
      </motion.aside>
    </motion.div>
  );
}
