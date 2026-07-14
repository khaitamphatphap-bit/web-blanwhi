"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ProductRow = {
  key: string;
  size: string;
  sku: string;
  color?: string;
  classificationName?: string;
  pancakeProductId?: string;
  pancakeVariationId?: string;
  pancakeSku?: string;
  publishQuantity?: number;
  pancakeQuantity?: number;
  availableQuantity: number;
  linked: boolean;
  lastSyncedAt?: string;
};

type PancakeVariation = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  quantity: number;
};

type Dashboard = {
  configuration: { apiKey: boolean; token: boolean; shopId: boolean; webhookSecret: boolean; baseUrl: string };
  webhookUrl: string;
  products: Array<{ id: string; name: string; rows: ProductRow[] }>;
  logs: Array<{ id: string; level: string; action: string; message: string; orderCode?: string; createdAt: string }>;
  queueCount: number;
};

type ApiResult = { dashboard: Dashboard; result?: unknown; error?: string };

export function PancakeAdmin() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [variations, setVariations] = useState<PancakeVariation[]>([]);
  const [editingKey, setEditingKey] = useState("");
  const [selectedVariationId, setSelectedVariationId] = useState("");
  const [variationSearch, setVariationSearch] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  async function request(body: Record<string, unknown>) {
    const response = await fetch("/api/admin/pancake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = await response.json() as ApiResult;
    if (!response.ok) throw new Error(result.error || "Không thực hiện được.");
    return result;
  }

  async function load() {
    const response = await fetch(`/api/admin/pancake?refresh=${Date.now()}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không tải được Pancake Integration.");
    setDashboard(result);
    return result as Dashboard;
  }

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : "Không tải được dữ liệu."));
  }, []);

  async function action(name: "test" | "sync-inventory") {
    setBusy(name);
    setMessage("");
    try {
      const response = await request({ action: name });
      setDashboard(response.dashboard);
      const testResult = response.result as { shopName?: string } | undefined;
      setMessage(name === "test" ? `Kết nối thành công: ${testResult?.shopName || "Pancake POS"}` : "Đã đồng bộ tồn kho Pancake.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thực hiện được.");
    } finally {
      setBusy("");
    }
  }

  async function openLink(productId: string, row: ProductRow) {
    const key = `${productId}::${row.key}`;
    setEditingKey(key);
    setSelectedVariationId(row.pancakeVariationId || "");
    setVariationSearch("");
    setMessage("");
    if (variations.length) return;
    setBusy("variations");
    try {
      const response = await request({ action: "variations" });
      setVariations((response.result || []) as PancakeVariation[]);
      setDashboard(response.dashboard);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không đọc được danh sách sản phẩm Pancake.");
      setEditingKey("");
    } finally {
      setBusy("");
    }
  }

  async function saveLink(productId: string, rowKey: string, variationId: string) {
    const operation = variationId ? "link" : "unlink";
    setBusy(`${operation}:${productId}::${rowKey}`);
    setMessage("");
    try {
      const response = await request({ action: "link-product", productId, rowKey, variationId });
      setDashboard(response.dashboard);
      await load();
      setEditingKey("");
      setSelectedVariationId("");
      const selectedVariation = variations.find((item) => item.id === variationId);
      setMessage(variationId
        ? `Đã xác minh liên kết thành công${selectedVariation ? `: ${selectedVariation.name || "Sản phẩm Pancake"} · SKU ${selectedVariation.sku || "—"}` : ""}.`
        : "Đã xác minh hủy liên kết Pancake POS thành công.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không lưu được liên kết.");
    } finally {
      setBusy("");
    }
  }

  const filteredVariations = useMemo(() => {
    const search = variationSearch.trim().toUpperCase();
    if (!search) return variations;
    return variations.filter((item) => [item.name, item.sku, item.productId, item.id].some((value) => value.toUpperCase().includes(search)));
  }, [variationSearch, variations]);

  if (!dashboard) return <main className="min-h-screen bg-white p-6 text-black">Đang tải Pancake Integration...</main>;
  const linkedCount = dashboard.products.reduce((sum, product) => sum + product.rows.filter((row) => row.linked).length, 0);
  const rowCount = dashboard.products.reduce((sum, product) => sum + product.rows.length, 0);

  return (
    <main className="min-h-screen bg-white p-5 text-black md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-black pb-5">
        <div><p className="text-xs uppercase tracking-[.18em] text-neutral-500">BLANWHI Admin</p><h1 className="mt-2 text-4xl font-medium">Pancake Integration</h1></div>
        <div className="flex gap-2"><Link href="/admin/site" className="border border-black px-4 py-3 text-xs uppercase">Sản phẩm</Link><Link href="/admin/orders" className="border border-black px-4 py-3 text-xs uppercase">Đơn hàng</Link></div>
      </header>

      {message && <p className="sticky top-2 z-20 mt-4 border border-neutral-300 bg-white p-3 text-sm shadow-sm">{message}</p>}

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="border border-black p-5">
          <h2 className="text-lg font-semibold uppercase">API Key / Token</h2>
          <p className="mt-2 text-sm text-neutral-600">Khóa được đọc từ Vercel và không hiển thị hoặc lưu trong trang admin.</p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            {([['PANCAKE_API_KEY', dashboard.configuration.apiKey], ['PANCAKE_TOKEN', dashboard.configuration.token], ['PANCAKE_SHOP_ID', dashboard.configuration.shopId], ['PANCAKE_WEBHOOK_SECRET', dashboard.configuration.webhookSecret]] as Array<[string, boolean]>).map(([name, ready]) => <div key={name} className="border p-3"><strong className="block text-xs">{name}</strong><span className={ready ? "text-green-700" : "text-red-600"}>{ready ? "Đã cấu hình" : name === "PANCAKE_TOKEN" ? "Không bắt buộc" : "Chưa có"}</span></div>)}
          </div>
          <p className="mt-3 break-all text-xs text-neutral-500">API: {dashboard.configuration.baseUrl}</p>
          <button onClick={() => action("test")} disabled={Boolean(busy)} className="mt-4 h-11 bg-black px-5 text-xs uppercase text-white disabled:opacity-50">{busy === "test" ? "Đang kiểm tra..." : "Kiểm tra kết nối"}</button>
        </div>
        <div className="border border-black p-5">
          <h2 className="text-lg font-semibold uppercase">Webhook / Đồng bộ định kỳ</h2>
          <p className="mt-2 text-sm text-neutral-600">Webhook cập nhật trạng thái đơn; đồng bộ định kỳ dùng khi Pancake không gửi webhook.</p>
          <code className="mt-4 block break-all bg-neutral-100 p-3 text-xs">{dashboard.webhookUrl}</code>
          <p className="mt-3 text-sm">Hàng đợi đang chờ: <strong>{dashboard.queueCount}</strong></p>
        </div>
      </section>

      <section className="mt-6 border border-black p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold uppercase">Liên kết từng sản phẩm</h2><p className="mt-1 text-sm text-neutral-600">Đã liên kết {linkedCount}/{rowCount} dòng. Bấm Liên kết ở đúng phân loại, màu và size rồi chọn sản phẩm có sẵn trong Pancake POS.</p></div>
          <button onClick={() => action("sync-inventory")} disabled={Boolean(busy)} className="h-11 bg-black px-5 text-xs uppercase text-white disabled:opacity-50">{busy === "sync-inventory" ? "Đang đồng bộ..." : "Đồng bộ tồn kho"}</button>
        </div>

        <div className="mt-5 grid gap-4">
          {dashboard.products.map((product) => <article key={product.id} className="border border-neutral-300">
            <h3 className="border-b border-neutral-300 bg-neutral-100 px-4 py-3 font-semibold">{product.name}</h3>
            <div className="divide-y divide-neutral-200">
              {product.rows.map((row) => {
                const rowEditorKey = `${product.id}::${row.key}`;
                const isEditing = editingKey === rowEditorKey;
                const isSaving = busy.endsWith(rowEditorKey);
                return <div key={row.key} className="grid gap-3 p-4 lg:grid-cols-[1.1fr_1.3fr_.7fr_auto] lg:items-center">
                  <div>
                    <p className="font-semibold">{[row.classificationName, row.color, `Size ${row.size}`].filter(Boolean).join(" · ")}</p>
                    <p className="mt-1 font-mono text-xs text-neutral-500">SKU web: {row.sku}</p>
                  </div>
                  <div className="text-sm">
                    {row.linked ? <><p className="font-medium text-green-700">Đã liên kết</p><p className="mt-1 break-all">{row.pancakeSku || "Không có SKU"} · ID {row.pancakeVariationId || row.pancakeProductId}</p></> : <p className="font-medium text-red-600">Chưa liên kết</p>}
                  </div>
                  <div className="text-sm"><p>Mở bán: <strong>{row.publishQuantity || 0}</strong></p><p>Tồn POS: <strong>{row.pancakeQuantity || 0}</strong></p><p>Có thể bán: <strong>{row.availableQuantity}</strong></p></div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <button onClick={() => openLink(product.id, row)} disabled={Boolean(busy)} className="border border-black px-4 py-2 text-xs uppercase disabled:opacity-50">{busy === "variations" && isEditing ? "Đang tải POS..." : row.linked ? "Thay đổi" : "Liên kết"}</button>
                    {row.linked && <button onClick={() => saveLink(product.id, row.key, "")} disabled={Boolean(busy)} className="border border-red-500 px-4 py-2 text-xs uppercase text-red-600 disabled:opacity-50">{isSaving ? "Đang hủy..." : "Hủy liên kết"}</button>}
                  </div>

                  {isEditing && <div className="border-t border-dashed border-neutral-300 pt-4 lg:col-span-4">
                    <label className="block text-xs font-semibold uppercase">Tìm sản phẩm/SKU trong Pancake POS
                      <input value={variationSearch} onChange={(event) => setVariationSearch(event.target.value)} placeholder="Nhập tên, SKU, Product ID hoặc Variation ID" className="mt-2 h-11 w-full border border-neutral-400 px-3 text-sm font-normal normal-case" />
                    </label>
                    <label className="mt-3 block text-xs font-semibold uppercase">Chọn đúng biến thể Pancake
                      <select value={selectedVariationId} onChange={(event) => setSelectedVariationId(event.target.value)} className="mt-2 h-12 w-full border border-black bg-white px-3 text-sm font-normal normal-case">
                        <option value="">— Chọn sản phẩm/biến thể Pancake —</option>
                        {filteredVariations.map((variation) => <option key={variation.id} value={variation.id}>{variation.name || "Sản phẩm Pancake"} · SKU {variation.sku || "—"} · Tồn {variation.quantity} · ID {variation.id}</option>)}
                      </select>
                    </label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => saveLink(product.id, row.key, selectedVariationId)} disabled={!selectedVariationId || Boolean(busy)} className="bg-black px-5 py-3 text-xs uppercase text-white disabled:opacity-40">{isSaving ? "Đang lưu..." : "Lưu liên kết"}</button>
                      <button onClick={() => setEditingKey("")} disabled={Boolean(busy)} className="border border-neutral-400 px-5 py-3 text-xs uppercase disabled:opacity-40">Đóng</button>
                      <span className="self-center text-xs text-neutral-500">Tìm thấy {filteredVariations.length} biến thể POS</span>
                    </div>
                  </div>}
                </div>;
              })}
            </div>
          </article>)}
        </div>
      </section>

      <section className="mt-6 border border-black p-5"><h2 className="text-lg font-semibold uppercase">Nhật ký lỗi và đồng bộ</h2><div className="mt-4 grid gap-2">{dashboard.logs.length ? dashboard.logs.map((log) => <div key={log.id} className="border border-neutral-200 p-3 text-sm"><span className={log.level === "error" ? "text-red-600" : log.level === "warning" ? "text-amber-700" : "text-green-700"}>{log.level.toUpperCase()}</span> · <strong>{log.action}</strong>{log.orderCode ? ` · ${log.orderCode}` : ""}<p className="mt-1">{log.message}</p><time className="mt-1 block text-xs text-neutral-500">{new Date(log.createdAt).toLocaleString("vi-VN")}</time></div>) : <p className="text-sm text-neutral-500">Chưa có nhật ký.</p>}</div></section>
    </main>
  );
}
