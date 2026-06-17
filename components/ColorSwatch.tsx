"use client";

import { ColorOption } from "@/lib/types";

export function ColorSwatch({
  colors,
  value,
  onChange
}: {
  colors: ColorOption[];
  value: ColorOption;
  onChange: (color: ColorOption) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((color) => (
        <button
          key={color.name}
          onClick={() => onChange(color)}
          title={color.name}
          className={`focus-ring h-8 w-8 rounded-full border transition ${value.name === color.name ? "border-black p-1" : "border-neutral-300 p-0.5 hover:border-neutral-700"}`}
        >
          <span className="block h-full w-full rounded-full border border-black/10" style={{ background: color.value }} />
        </button>
      ))}
    </div>
  );
}
