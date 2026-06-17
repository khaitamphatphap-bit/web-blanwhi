"use client";

import { MessageCircle } from "lucide-react";
import { useState } from "react";
import { faq } from "@/lib/data";

const prompts = [
  "Gợi ý combo sáng da",
  "Áo đen phối quần gì?",
  "Tôi muốn xem chất vải",
  "Tôi muốn xem màu thật",
  "Dáng người đầy đặn mặc gì?"
];

export function StyleAssistant() {
  const [open, setOpen] = useState(true);
  const [answer, setAnswer] = useState("Mình ở đây để giúp cậu chọn nhanh hơn: màu, size, combo, đổi trả, phí ship.");

  const reply = (prompt: string) => {
    const map: Record<string, string> = {
      "Gợi ý combo sáng da": "Tone trắng ash, stone hoặc xám tro sẽ làm mặt sáng hơn. Ghép Essential Tee trắng với Wide Leg Trouser đen là set an toàn và cao cấp.",
      "Áo đen phối quần gì?": "Áo đen đẹp nhất khi đi với quần xám tro, stone hoặc olive trầm. Nếu muốn lạnh và gọn, chọn quần charcoal.",
      "Tôi muốn xem chất vải": "Ở trang sản phẩm, bấm câu hỏi xem chất vải, video sẽ mở ngay bên dưới để cậu nhìn độ dày và bề mặt vải.",
      "Tôi muốn xem màu thật": "Ở trang sản phẩm có video màu ngoài đời. Nên xem dưới ánh sáng tự nhiên để chọn đúng tone.",
      "Dáng người đầy đặn mặc gì?": "Chọn form boxy hoặc rộng nhẹ, tránh quá bó. Hoodie drop shoulder và quần ống thoải mái sẽ cân dáng tốt."
    };
    setAnswer(map[prompt]);
  };

  return (
    <div className="fixed bottom-4 right-4 z-30 w-[calc(100vw-2rem)] max-w-sm">
      {open && (
        <div className="mb-2 border border-neutral-200 bg-white p-4 shadow-soft">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium uppercase tracking-[0.12em]">Style assistant</h3>
            <button onClick={() => setOpen(false)} className="text-xs text-neutral-500">Ẩn</button>
          </div>
          <p className="text-sm leading-relaxed text-neutral-600">{answer}</p>
          <div className="mt-4 flex gap-2 overflow-auto no-scrollbar">
            {prompts.map((prompt) => (
              <button key={prompt} onClick={() => reply(prompt)} className="shrink-0 border border-neutral-200 px-3 py-2 text-xs hover:border-black">{prompt}</button>
            ))}
          </div>
          <div className="mt-4 grid gap-2 border-t border-neutral-100 pt-3">
            {faq.slice(0, 2).map(([q, a]) => (
              <button key={q} onClick={() => setAnswer(a)} className="text-left text-xs text-neutral-500 hover:text-black">{q}</button>
            ))}
          </div>
        </div>
      )}
      <button onClick={() => setOpen(!open)} className="ml-auto flex h-12 items-center gap-2 bg-black px-4 text-xs uppercase tracking-[0.14em] text-white">
        <MessageCircle size={16} />
        Hỏi nhanh
      </button>
    </div>
  );
}
