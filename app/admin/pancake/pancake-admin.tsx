"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Dashboard = {
  configuration: { apiKey: boolean; token: boolean; shopId: boolean; webhookSecret: boolean; baseUrl: string };
  webhookUrl: string;
  products: Array<{ id: string; name: string; rows: Array<{ key: string; size: string; sku: string; pancakeProductId?: string; pancakeSku?: string; publishQuantity?: number; pancakeQuantity?: number; availableQuantity: number; linked: boolean; lastSyncedAt?: string }> }>;
  logs: Array<{ id: string; level: string; action: string; message: string; orderCode?: string; createdAt: string }>;
  queueCount: number;
};

export function PancakeAdmin() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const response = await fetch("/api/admin/pancake", { cache: "no-store" });
    setDashboard(await response.json());
  }

  useEffect(() => { void load(); }, []);

  async function action(name: "test" | "sync-inventory") {
    setBusy(name);
    setMessage("");
    try {
      const response = await fetch("/api/admin/pancake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: name }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Không thực hiện được.");
      setDashboard(result.dashboard);
      setMessage(name === "test" ? `Kết nối thành công: ${result.result.shopName}` : "Đã đồng bộ tồn kho Pancake.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thực hiện được.");
    } finally {
      setBusy("");
    }
  }

  if (!dashboard) return <main className="min-h-screen bg-white p-6 text-black">Đang tải Pancake Integration...</main>;
  const linkedCount = dashboard.products.reduce((sum, product) => sum + product.rows.filter((row) => row.linked).length, 0);
  const rowCount = dashboard.products.reduce((sum, product) => sum + product.rows.length, 0);

  return (
    <main className="min-h-screen bg-white p-5 text-black md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-black pb-5">
        <div><p className="text-xs uppercase tracking-[.18em] text-neutral-500">BLANWHI Admin</p><h1 className="mt-2 text-4xl font-medium">Pancake Integration</h1></div>
        <div className="flex gap-2"><Link href="/admin/site" className="border border-black px-4 py-3 text-xs uppercase">Sản phẩm</Link><Link href="/admin/orders" className="border border-black px-4 py-3 text-xs uppercase">Đơn hàng</Link></div>
      </header>

      {message && <p className="mt-4 border border-neutral-300 bg-neutral-50 p-3 text-sm">{message}</p>}

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="border border-black p-5">
          <h2 className="text-lg font-semibold uppercase">API Key / Token</h2>
          <p className="mt-2 text-sm text-neutral-600">Thông tin bí mật được đọc từ Environment Variables của Vercel và không hiển thị hoặc lưu trong trang admin.</p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            {[['PANCAKE_API_KEY', dashboard.configuration.apiKey], ['PANCAKE_TOKEN', dashboard.configuration.token], ['PANCAKE_SHOP_ID', dashboard.configuration.shopId], ['PANCAKE_WEBHOOK_SECRET', dashboard.configuration.webhookSecret]].map(([name, ready]) => <div key={String(name)} className="border p-3"><strong className="block text-xs">{name}</strong><span className={ready ? "text-green-700" : "text-red-600"}>{ready ? "Đã cấu hình" : "Chưa có"}</span></div>)}
          </div>
          <p className="mt-3 break-all text-xs text-neutral-500">API: {dashboard.configuration.baseUrl}</p>
          <button onClick={() => action("test")} disabled={Boolean(busy)} className="mt-4 h-11 bg-black px-5 text-xs uppercase text-white disabled:opacity-50">{busy === "test" ? "Đang kiểm tra..." : "Test connection"}</button>
        </div>
        <div className="border border-black p-5">
          <h2 className="text-lg font-semibold uppercase">Webhook / Polling</h2>
          <p className="mt-2 text-sm text-neutral-600">Ưu tiên webhook cập nhật trạng thái đơn. Nếu webhook không hoạt động, cron sẽ thử lại hàng đợi và đồng bộ tồn kho.</p>
          <code className="mt-4 block break-all bg-neutral-100 p-3 text-xs">{dashboard.webhookUrl}</code>
          <p className="mt-3 text-sm">Hàng đợi đang chờ: <strong>{dashboard.queueCount}</strong></p>
        </div>
      </section>

      <section className="mt-6 border border-black p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold uppercase">Sản phẩm đã liên kết</h2><p className="mt-1 text-sm text-neutral-600">Đã liên kết {linkedCount}/{rowCount} biến thể. Chỉnh Product ID, SKU và publish_quantity trong trang Sản phẩm.</p></div><button onClick={() => action("sync-inventory")} disabled={Boolean(busy)} className="h-11 bg-black px-5 text-xs uppercase text-white disabled:opacity-50">{busy === "sync-inventory" ? "Đang đồng bộ..." : "Đồng bộ tồn kho"}</button></div>
        <div className="mt-4 overflow-x-auto"><table className="min-w-[900px] w-full text-left text-sm"><thead className="bg-neutral-100 text-xs uppercase"><tr><th className="p-3">Sản phẩm</th><th className="p-3">Size/SKU web</th><th className="p-3">Pancake Product ID / SKU</th><th className="p-3">publish_quantity</th><th className="p-3">Tồn Pancake</th><th className="p-3">Có thể bán</th></tr></thead><tbody>{dashboard.products.flatMap((product) => product.rows.map((row) => <tr key={`${product.id}-${row.key}`} className="border-t"><td className="p-3 font-semibold">{product.name}</td><td className="p-3">{row.size} · {row.sku}</td><td className="p-3">{row.linked ? `${row.pancakeProductId || "—"} / ${row.pancakeSku || "—"}` : <span className="text-red-600">Chưa liên kết</span>}</td><td className="p-3">{row.publishQuantity || 0}</td><td className="p-3">{row.pancakeQuantity || 0}</td><td className="p-3 font-bold">{row.availableQuantity}</td></tr>))}</tbody></table></div>
        <Link href="/admin/site#product-editor" className="mt-4 inline-block border border-black px-4 py-3 text-xs uppercase">Liên kết / thay đổi / hủy liên kết</Link>
      </section>

      <section className="mt-6 border border-black p-5"><h2 className="text-lg font-semibold uppercase">Log lỗi và đồng bộ</h2><div className="mt-4 grid gap-2">{dashboard.logs.length ? dashboard.logs.map((log) => <div key={log.id} className="border border-neutral-200 p-3 text-sm"><span className={log.level === "error" ? "text-red-600" : log.level === "warning" ? "text-amber-700" : "text-green-700"}>{log.level.toUpperCase()}</span> · <strong>{log.action}</strong>{log.orderCode ? ` · ${log.orderCode}` : ""}<p className="mt-1">{log.message}</p><time className="mt-1 block text-xs text-neutral-500">{new Date(log.createdAt).toLocaleString("vi-VN")}</time></div>) : <p className="text-sm text-neutral-500">Chưa có log.</p>}</div></section>
    </main>
  );
}
