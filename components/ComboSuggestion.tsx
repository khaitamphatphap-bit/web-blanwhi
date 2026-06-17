"use client";

import { combos, products } from "@/lib/data";
import { money } from "@/lib/pricing";
import { Combo } from "@/lib/types";

export function ComboSuggestion({ onAddCombo, compact = false }: { onAddCombo: (combo: Combo) => void; compact?: boolean }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-neutral-500">Combo gợi ý</p>
        <h2 className={`${compact ? "text-lg" : "text-2xl"} font-medium`}>Mua theo set, ít nghĩ hơn.</h2>
      </div>
      <div className={`grid gap-3 ${compact ? "" : "md:grid-cols-3"}`}>
        {combos.map((combo) => {
          const comboProducts = combo.productIds.map((id) => products.find((product) => product.id === id)).filter(Boolean);
          return (
            <article key={combo.id} className="border border-neutral-200 bg-white p-4">
              <div className="flex gap-2">
                {comboProducts.map((product) => (
                  <img key={product!.id} src={product!.image} alt={product!.name} className="h-20 w-16 object-cover" />
                ))}
              </div>
              <h3 className="mt-4 text-sm font-medium uppercase tracking-[0.1em]">{combo.title}</h3>
              <p className="mt-1 text-sm text-neutral-500">{combo.description}</p>
              <div className="mt-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm">{money(combo.price)}</p>
                  <p className="text-xs text-neutral-400 line-through">{money(combo.originalPrice)}</p>
                </div>
                <button onClick={() => onAddCombo(combo)} className="focus-ring bg-black px-4 py-2 text-xs uppercase tracking-[0.12em] text-white">
                  Thêm combo
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
