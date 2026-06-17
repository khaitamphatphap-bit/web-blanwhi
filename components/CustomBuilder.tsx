"use client";

import { useState } from "react";
import { PriceEstimator } from "./PriceEstimator";
import { UploadLogo } from "./UploadLogo";

export function CustomBuilder() {
  const [quantity, setQuantity] = useState(10);
  const [positions, setPositions] = useState(1);
  const [printSize, setPrintSize] = useState(18);
  const [printType, setPrintType] = useState("DTF");
  const [logo, setLogo] = useState("");
  const [text, setText] = useState("BL STUDIO");
  const [font, setFont] = useState("Inter");
  const [textColor, setTextColor] = useState("#111111");
  const [pos, setPos] = useState({ x: 45, y: 42 });

  return (
    <section id="custom" className="py-14">
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-neutral-500">Custom đồng phục</p>
          <h2 className="mt-2 text-3xl font-medium">Mockup trực quan, báo giá ngay.</h2>
        </div>
        <p className="max-w-md text-sm text-neutral-500">Tối thiểu 10 áo. Chọn áo, màu, size, upload logo, thêm text và gửi yêu cầu tư vấn hoặc đặt cọc.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <div className="grid min-h-[520px] place-items-center bg-white p-6 shadow-soft">
          <div className="relative h-[440px] w-[320px]">
            <div className="absolute left-1/2 top-8 h-[380px] w-[230px] -translate-x-1/2 rounded-t-[52px] bg-neutral-100 shadow-inner" />
            <div className="absolute left-8 top-24 h-44 w-20 rotate-12 bg-neutral-100" />
            <div className="absolute right-8 top-24 h-44 w-20 -rotate-12 bg-neutral-100" />
            <div
              className="absolute grid min-h-20 min-w-24 cursor-move place-items-center border border-dashed border-neutral-400 bg-white/80 p-2 text-center text-xs"
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%, -50%)" }}
              draggable
              onDragEnd={(event) => {
                const rect = event.currentTarget.parentElement!.getBoundingClientRect();
                setPos({ x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 });
              }}
            >
              {logo && <img src={logo} alt="Logo upload" className="mb-1 max-h-14 max-w-20 object-contain" />}
              <span style={{ color: textColor, fontFamily: font }}>{text}</span>
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div className="grid gap-3 bg-white p-5 shadow-soft">
            <label className="text-sm">Loại áo<select className="mt-2 h-11 w-full border border-neutral-200 px-3"><option>Heavy tee</option><option>Oversize tee</option><option>Hoodie</option></select></label>
            <label className="text-sm">Màu áo<select className="mt-2 h-11 w-full border border-neutral-200 px-3"><option>Trắng</option><option>Đen</option><option>Xám tro</option></select></label>
            <label className="text-sm">Tổng số lượng<input min={10} type="number" value={quantity} onChange={(e) => setQuantity(Math.max(10, Number(e.target.value)))} className="mt-2 h-11 w-full border border-neutral-200 px-3" /></label>
            <div className="grid grid-cols-4 gap-2 text-sm">
              {["S", "M", "L", "XL"].map((size) => <input key={size} placeholder={size} className="h-10 border border-neutral-200 px-2" />)}
            </div>
            <UploadLogo onFile={setLogo} />
            <input value={text} onChange={(e) => setText(e.target.value)} className="h-11 border border-neutral-200 px-3" placeholder="Text in thêm" />
            <div className="grid grid-cols-2 gap-3">
              <select value={font} onChange={(e) => setFont(e.target.value)} className="h-11 border border-neutral-200 px-3"><option>Inter</option><option>Arial</option><option>Georgia</option></select>
              <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="h-11 w-full border border-neutral-200 bg-white p-1" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {["Trước ngực", "Sau lưng", "Tay áo"].map((item, index) => (
                <label key={item} className="flex h-10 items-center justify-center border border-neutral-200 text-xs">
                  <input type="checkbox" checked={index < positions} onChange={() => setPositions(index + 1)} className="mr-2" />{item}
                </label>
              ))}
            </div>
            <label className="text-sm">Kích thước hình in<input type="range" min={8} max={32} value={printSize} onChange={(e) => setPrintSize(Number(e.target.value))} className="mt-2 w-full" /></label>
            <select value={printType} onChange={(e) => setPrintType(e.target.value)} className="h-11 border border-neutral-200 px-3"><option>DTF</option><option>Lụa</option><option>Thêu</option></select>
          </div>
          <PriceEstimator quantity={quantity} positions={positions} printSize={printSize} printType={printType} />
          <div className="grid grid-cols-2 gap-2">
            <button className="h-12 border border-black bg-white text-sm uppercase tracking-[0.12em]">Gửi tư vấn</button>
            <button className="h-12 bg-black text-sm uppercase tracking-[0.12em] text-white">Đặt cọc</button>
          </div>
        </div>
      </div>
    </section>
  );
}
