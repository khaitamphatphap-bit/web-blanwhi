"use client";

import { useMemo, useState } from "react";
import { adviseSize } from "@/lib/pricing";

export function SizeAdvisor() {
  const [height, setHeight] = useState(172);
  const [weight, setWeight] = useState(65);
  const [body, setBody] = useState("vừa");
  const [fit, setFit] = useState("rộng nhẹ");
  const advice = useMemo(() => adviseSize(height, weight, body, fit), [height, weight, body, fit]);

  return (
    <section id="size" className="grid gap-8 border-y border-neutral-200 py-12 lg:grid-cols-[0.8fr_1.2fr]">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-neutral-500">Tư vấn size</p>
        <h2 className="mt-2 text-3xl font-medium">Tư vấn như shop thật, không máy móc.</h2>
      </div>
      <div className="grid gap-5 bg-white p-5 shadow-soft md:grid-cols-2">
        <label className="text-sm">
          Chiều cao
          <input type="number" value={height} onChange={(e) => setHeight(Number(e.target.value))} className="mt-2 h-11 w-full border border-neutral-200 px-3" />
        </label>
        <label className="text-sm">
          Cân nặng
          <input type="number" value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="mt-2 h-11 w-full border border-neutral-200 px-3" />
        </label>
        <label className="text-sm">
          Form người
          <select value={body} onChange={(e) => setBody(e.target.value)} className="mt-2 h-11 w-full border border-neutral-200 px-3">
            <option>gầy</option>
            <option>vừa</option>
            <option>đầy đặn</option>
          </select>
        </label>
        <label className="text-sm">
          Sở thích mặc
          <select value={fit} onChange={(e) => setFit(e.target.value)} className="mt-2 h-11 w-full border border-neutral-200 px-3">
            <option>vừa người</option>
            <option>rộng nhẹ</option>
            <option>oversize</option>
          </select>
        </label>
        <div className="md:col-span-2 grid gap-4 bg-neutral-950 p-5 text-white md:grid-cols-[120px_1fr]">
          <div className="grid aspect-[3/4] place-items-center bg-neutral-800 text-4xl font-medium">{advice.size}</div>
          <div>
            <p className="text-lg leading-relaxed">{advice.note}</p>
            <p className="mt-3 text-sm text-white/60">{advice.model}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
