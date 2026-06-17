"use client";

import { motion } from "framer-motion";
import { ShoppingBag } from "lucide-react";
import { money } from "@/lib/pricing";
import { Product, ColorOption } from "@/lib/types";
import { ColorSwatch } from "./ColorSwatch";
import { useState } from "react";
import type { CSSProperties } from "react";

function mockKind(type: Product["type"]) {
  if (type === "Pants" || type === "Shorts") return "pants";
  if (type === "Hoodie") return "hoodie";
  if (type === "Jacket" || type === "Shirt") return "jacket";
  return "tee";
}

function ProductMock({ product, color }: { product: Product; color: ColorOption }) {
  const kind = mockKind(product.type);
  const light = color.tone === "light" || color.name === "Trắng";
  const style = {
    "--garment": color.value,
    "--garment-border": light ? "1px solid #d8d8d8" : "0",
    "--neck-border": light ? "1px solid #d8d8d8" : "1px solid rgba(255,255,255,.22)"
  } as CSSProperties;

  if (kind === "pants") {
    return <div className="mock pants" style={style}><span className="body" /><span className="leg-a" /><span className="leg-b" /></div>;
  }
  if (kind === "hoodie") {
    return <div className="mock hoodie" style={style}><span className="hood" /><span className="left" /><span className="right" /><span className="body" /><span className="zip" /></div>;
  }
  if (kind === "jacket") {
    return <div className="mock jacket" style={style}><span className="left" /><span className="right" /><span className="body" /><span className="zip" /></div>;
  }
  return <div className="mock tee" style={style}><span className="left" /><span className="right" /><span className="body" /></div>;
}

export function ProductCard({
  product,
  onQuickAdd,
  onOpen
}: {
  product: Product;
  onQuickAdd: (product: Product, color: ColorOption, size: string) => void;
  onOpen: (product: Product) => void;
}) {
  const [color, setColor] = useState(product.colors[0]);
  const [size, setSize] = useState(product.sizes[1]);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="group"
    >
      <button onClick={() => onOpen(product)} className="block w-full overflow-hidden bg-[#f7f7f5] text-left">
        <div className="product-visual transition duration-700 group-hover:scale-[1.018]" aria-label={`Hình sản phẩm ${product.name}`}>
          <ProductMock product={product} color={color} />
        </div>
      </button>
      <div className="space-y-3 py-3">
        <div className="flex items-start justify-between gap-4">
          <button onClick={() => onOpen(product)} className="text-left">
            <h3 className="text-[13px] font-medium">{product.name}</h3>
            <p className="mt-1 text-xs text-neutral-500">{product.fit}</p>
          </button>
          <p className="shrink-0 text-sm">{money(product.price)}</p>
        </div>
        <ColorSwatch colors={product.colors} value={color} onChange={setColor} />
        <div className="flex gap-1">
          {product.sizes.map((item) => (
            <button
              key={item}
              onClick={() => setSize(item)}
              className={`focus-ring h-8 min-w-8 border px-2 text-xs transition ${size === item ? "border-black bg-black text-white" : "border-neutral-200 bg-white hover:border-neutral-700"}`}
            >
              {item}
            </button>
          ))}
        </div>
        <button
          onClick={() => onQuickAdd(product, color, size)}
          className="focus-ring flex h-9 w-full items-center justify-center gap-2 border border-black bg-transparent text-xs font-medium uppercase text-black transition hover:bg-black hover:text-white"
        >
          <ShoppingBag size={15} />
          Thêm nhanh
        </button>
      </div>
    </motion.article>
  );
}
