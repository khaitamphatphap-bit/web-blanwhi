"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type TraceHit = {
  source: string;
  matched: string[];
  summary: string;
  record: unknown;
};

type TraceResult = {
  terms?: string[];
  count?: number;
  hits?: TraceHit[];
  error?: string;
};

function prettyRecord(record: unknown) {
  try {
    return JSON.stringify(record, null, 2);
  } catch {
    return String(record);
  }
}

export default function AdminOrderTracePage() {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TraceResult | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`/api/admin/order-trace?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : "Không truy vết được đơn." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-100 px-5 py-8 text-neutral-950">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-300 pb-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">BLANWHI admin</p>
            <h1 className="mt-2 text-3xl font-medium">Truy vết đơn hàng</h1>
          </div>
          <Link href="/admin/orders" className="h-10 border border-black px-4 pt-2 text-xs uppercase">Quản trị đơn</Link>
        </header>

        <form onSubmit={search} className="mt-6 border border-neutral-300 bg-white p-4">
          <label className="text-sm font-semibold uppercase" htmlFor="trace-query">Nhập mã đơn, SĐT, mã ZaloPay hoặc số tiền</label>
          <textarea
            id="trace-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            rows={5}
            className="mt-3 w-full border border-neutral-300 p-3 text-sm"
            placeholder="Ví dụ: BLW-260901162527-QLV5, BLW-260901164928-PTT7, 0904496153, 531000"
          />
          <button disabled={busy || query.trim().length < 3} className="mt-3 h-11 border border-black bg-black px-5 text-sm uppercase text-white disabled:opacity-50">
            {busy ? "Đang truy vết..." : "Truy vết"}
          </button>
        </form>

        {result?.error && <p className="mt-4 border border-red-300 bg-red-50 p-3 text-sm text-red-800">{result.error}</p>}

        {result && !result.error && (
          <section className="mt-6">
            <div className="border border-neutral-300 bg-white p-4">
              <p className="text-sm text-neutral-600">Từ khóa đã quét: {result.terms?.join(", ") || "Không có"}</p>
              <h2 className="mt-1 text-2xl font-medium">Tìm thấy {result.count || 0} dấu vết</h2>
            </div>

            <div className="mt-4 grid gap-3">
              {(result.hits || []).map((hit, index) => (
                <details key={`${hit.source}-${index}`} className="border border-neutral-300 bg-white p-4" open={index < 5}>
                  <summary className="cursor-pointer">
                    <span className="font-semibold">{hit.summary}</span>
                    <span className="ml-3 text-xs uppercase text-neutral-500">{hit.source}</span>
                  </summary>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {hit.matched.map((term) => <span key={term} className="border border-neutral-300 px-2 py-1">{term}</span>)}
                  </div>
                  <pre className="mt-3 max-h-96 overflow-auto bg-neutral-950 p-3 text-xs text-white">{prettyRecord(hit.record)}</pre>
                </details>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
