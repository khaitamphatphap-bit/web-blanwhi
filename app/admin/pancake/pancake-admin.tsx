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

type PancakeOrderSource = {
  id: string | number;
  name: string;
  pageId?: string;
  key?: string;
  account?: string;
};

type Dashboard = {
  connections: {
    activeNewOrders: "shop-1" | "shop-2";
    items: Array<{
      id: "shop-1" | "shop-2";
      name: string;
      configured: boolean;
      readyForNewOrders: boolean;
      receivesNewOrders: boolean;
      keepsExistingOrders: boolean;
      configuration: { apiKey: boolean; token: boolean; shopId: boolean; webhookSecret: boolean; baseUrl: string };
      productSync: { status: string; linkedCount: number; totalCount: number; lastSyncedAt?: string; message?: string };
      webhookUrl: string;
    }>;
  };
  configuration: { apiKey: boolean; token: boolean; shopId: boolean; webhookSecret: boolean; baseUrl: string };
  orderSource?: { targetName: string; targetId: string; sources: PancakeOrderSource[]; matched?: PancakeOrderSource; error?: string };
  storage: { database: boolean; blob: boolean; persistent: boolean };
  webhookUrl: string;
  products: Array<{ id: string; name: string; rows: ProductRow[] }>;
  logs: Array<{ id: string; level: string; action: string; message: string; orderCode?: string; createdAt: string }>;
  queueCount: number;
};

type ApiResult = { dashboard?: Dashboard; result?: unknown; error?: string };

type Shop1Snapshot = Pick<Dashboard, "configuration" | "storage" | "webhookUrl" | "products" | "logs" | "queueCount" | "orderSource">;

type LinkResult = {
  productId: string;
  rowKey: string;
  linked: boolean;
  pancakeProductId: string;
  pancakeVariationId: string;
  pancakeSku: string;
  pancakeQuantity: number;
  lastSyncedAt?: string;
};

export function PancakeAdmin() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [variations, setVariations] = useState<PancakeVariation[]>([]);
  const [expandedProductId, setExpandedProductId] = useState("");
  const [editingKey, setEditingKey] = useState("");
  const [selectedVariationId, setSelectedVariationId] = useState("");
  const [variationSearch, setVariationSearch] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [demoActiveConnection, setDemoActiveConnection] = useState<"shop-1" | "shop-2" | "">("");
  const [localConnectionDemo, setLocalConnectionDemo] = useState(false);
  const [shop1Snapshot, setShop1Snapshot] = useState<Shop1Snapshot | null>(null);

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

  async function load(useLocalSnapshot = false) {
    const response = await fetch(`/api/admin/pancake?refresh=${Date.now()}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không tải được Pancake Integration.");
    setDashboard(result);
    if (useLocalSnapshot) {
      const snapshotResponse = await fetch(`/_local-demo/pancake-shop1.json?refresh=${Date.now()}`, { cache: "no-store" });
      if (!snapshotResponse.ok) throw new Error("Không tải được ảnh chụp dữ liệu thật của Shop 1.");
      setShop1Snapshot(await snapshotResponse.json() as Shop1Snapshot);
    }
    return result as Dashboard;
  }

  useEffect(() => {
    const isLocalDemo = (
      ["127.0.0.1", "localhost"].includes(window.location.hostname)
      && new URLSearchParams(window.location.search).get("pancake2Demo") === "1"
    );
    setLocalConnectionDemo(isLocalDemo);
    void load(isLocalDemo).catch((error) => setMessage(error instanceof Error ? error.message : "Không tải được dữ liệu."));
  }, []);

  async function action(name: "test" | "sync-inventory" | "recover-links" | "order-sources") {
    if (localConnectionDemo) {
      setMessage("Bản local đang hiển thị ảnh chụp chỉ đọc của Shop 1; không gửi thao tác sang Pancake thật.");
      return;
    }
    setBusy(name);
    setMessage("");
    try {
      const response = await request({ action: name, connectionId: activeConnection });
      if (response.dashboard) setDashboard(response.dashboard);
      const result = response.result as { shopName?: string; recoveredCount?: number; scannedBackups?: number; sources?: PancakeOrderSource[]; matched?: PancakeOrderSource } | undefined;
      setMessage(name === "test"
        ? `Kết nối thành công: ${result?.shopName || "Pancake POS"}`
        : name === "recover-links"
          ? `Đã khôi phục ${result?.recoveredCount || 0} liên kết từ ${result?.scannedBackups || 0} bản lưu gần nhất.`
          : name === "order-sources"
            ? `Đã đọc ${result?.sources?.length || 0} nguồn đơn Pancake${result?.matched ? `, khớp nguồn ${result.matched.name} (#${result.matched.id})` : ", chưa khớp nguồn cấu hình"}.`
          : "Đã đồng bộ tồn kho Pancake.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thực hiện được.");
    } finally {
      setBusy("");
    }
  }

  async function setActiveConnection(connectionId: "shop-1" | "shop-2") {
    if (localConnectionDemo) {
      if (connectionId === "shop-2") {
        setMessage("Bản demo: Shop 2 chưa đủ API, Shop ID, webhook và liên kết sản phẩm nên chưa thể nhận đơn mới.");
        return;
      }
      setDemoActiveConnection(connectionId);
      setMessage(`Bản demo: đơn mới sẽ đi ${connectionId === "shop-1" ? "Shop 1" : "Shop 2"}; đơn cũ vẫn giữ nguyên shop ban đầu.`);
      return;
    }
    setBusy(`connection:${connectionId}`);
    setMessage("");
    try {
      const response = await request({ action: "set-active-connection", connectionId });
      if (response.dashboard) setDashboard(response.dashboard);
      setMessage(`Đã chuyển nơi nhận đơn mới sang ${connectionId === "shop-1" ? "Shop 1" : "Shop 2"}. Đơn cũ không thay đổi.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không chuyển được shop nhận đơn mới.");
    } finally {
      setBusy("");
    }
  }

  async function openLink(productId: string, row: ProductRow) {
    if (localConnectionDemo) {
      setMessage("Bản local chỉ đọc; liên kết sản phẩm Shop 1 thật được giữ nguyên.");
      return;
    }
    const key = `${productId}::${row.key}`;
    setEditingKey(key);
    setSelectedVariationId(row.pancakeVariationId || "");
    setVariationSearch("");
    setMessage("");
    if (variations.length) return;
    setBusy("variations");
    try {
      const response = await request({ action: "variations", connectionId: activeConnection });
      setVariations((response.result || []) as PancakeVariation[]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không đọc được danh sách sản phẩm Pancake.");
      setEditingKey("");
    } finally {
      setBusy("");
    }
  }

  async function saveLink(productId: string, rowKey: string, variationId: string) {
    if (localConnectionDemo) {
      setMessage("Bản local chỉ đọc; không thay đổi liên kết sản phẩm thật.");
      return;
    }
    const operation = variationId ? "link" : "unlink";
    setBusy(`${operation}:${productId}::${rowKey}`);
    setMessage("");
    try {
      const selectedVariation = variations.find((item) => item.id === variationId);
      const response = await request({ action: "link-product", connectionId: activeConnection, productId, rowKey, variationId, variation: selectedVariation });
      const saved = response.result as LinkResult;
      setDashboard((current) => current ? {
        ...current,
        products: current.products.map((product) => product.id === productId ? {
          ...product,
          rows: product.rows.map((row) => row.key === rowKey ? {
            ...row,
            linked: saved.linked,
            pancakeProductId: saved.pancakeProductId,
            pancakeVariationId: saved.pancakeVariationId,
            pancakeSku: saved.pancakeSku,
            pancakeQuantity: saved.pancakeQuantity,
            lastSyncedAt: saved.lastSyncedAt,
            availableQuantity: row.publishQuantity || 0
          } : row)
        } : product)
      } : current);
      setEditingKey("");
      setSelectedVariationId("");
      setMessage(variationId
        ? `Đã xác minh liên kết thành công${selectedVariation ? `: SKU ${selectedVariation.sku || selectedVariation.id}` : ""}.`
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
  const displayedProducts = localConnectionDemo && shop1Snapshot ? shop1Snapshot.products : dashboard.products;
  const displayedStorage = localConnectionDemo && shop1Snapshot ? shop1Snapshot.storage : dashboard.storage;
  const displayedQueueCount = localConnectionDemo && shop1Snapshot ? shop1Snapshot.queueCount : dashboard.queueCount;
  const displayedLogs = localConnectionDemo && shop1Snapshot ? shop1Snapshot.logs : dashboard.logs;
  const linkedCount = displayedProducts.reduce((sum, product) => sum + product.rows.filter((row) => row.linked).length, 0);
  const rowCount = displayedProducts.reduce((sum, product) => sum + product.rows.length, 0);
  const activeConnection = localConnectionDemo ? (demoActiveConnection || "shop-1") : dashboard.connections.activeNewOrders;
  const displayedConnections = dashboard.connections.items.map((connection) => {
    if (!localConnectionDemo) return connection;
    if (connection.id === "shop-1") {
      const configuration = shop1Snapshot?.configuration || connection.configuration;
      const configured = Boolean(configuration.apiKey && configuration.shopId && configuration.webhookSecret);
      return {
        ...connection,
        configured,
        readyForNewOrders: configured && linkedCount === rowCount,
        configuration,
        webhookUrl: shop1Snapshot?.webhookUrl || connection.webhookUrl,
        productSync: { status: "ready" as const, linkedCount, totalCount: rowCount, message: "Dữ liệu hiện tại của Shop 1 đang vận hành." }
      };
    }
    return {
      ...connection,
      configured: false,
      readyForNewOrders: false,
      configuration: { apiKey: false, token: false, shopId: false, webhookSecret: false, baseUrl: connection.configuration.baseUrl },
      productSync: { status: "not_started" as const, linkedCount: 0, totalCount: rowCount, message: "Chưa đồng bộ sản phẩm Shop 2." }
    };
  });
  const activeConnectionDetails = displayedConnections.find((connection) => connection.id === activeConnection)
    || displayedConnections[0];
  const activeConnectionPrefix = activeConnectionDetails?.id === "shop-2" ? "PANCAKE2" : "PANCAKE";
  const displayedOrderSource: Dashboard["orderSource"] = localConnectionDemo && activeConnection === "shop-1"
    ? shop1Snapshot?.orderSource
    : dashboard.orderSource;

  function toggleProduct(productId: string) {
    setExpandedProductId((current) => current === productId ? "" : productId);
    setEditingKey("");
    setSelectedVariationId("");
    setVariationSearch("");
  }

  return (
    <main className="min-h-screen bg-white p-5 text-black md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-black pb-5">
        <div><p className="text-xs uppercase tracking-[.18em] text-neutral-500">BLANWHI Admin</p><h1 className="mt-2 text-4xl font-medium">Pancake Integration</h1></div>
        <div className="flex gap-2"><Link href="/admin/site" className="border border-black px-4 py-3 text-xs uppercase">Sản phẩm</Link><Link href="/admin/orders" className="border border-black px-4 py-3 text-xs uppercase">Đơn hàng</Link></div>
      </header>

      {message && <p className="sticky top-2 z-20 mt-4 border border-neutral-300 bg-white p-3 text-sm shadow-sm">{message}</p>}

      <section className="mt-6 border border-black p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-neutral-500">Định tuyến đơn hàng</p>
            <h2 className="mt-2 text-2xl font-medium">Chọn shop nhận đơn mới</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">Ngừng nhận đơn mới không ngắt kết nối. Đơn cũ vẫn tiếp tục nhận mã vận đơn, trạng thái và yêu cầu hủy tại đúng shop ban đầu.</p>
          </div>
          {localConnectionDemo && <span className="border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-semibold uppercase text-amber-800">Dữ liệu Shop 1 thật · bản local chỉ đọc</span>}
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {displayedConnections.map((connection) => {
            const receivesNewOrders = activeConnection === connection.id;
            const missing = [
              !connection.configuration.apiKey && "API key",
              !connection.configuration.shopId && "Shop ID",
              !connection.configuration.webhookSecret && "Webhook secret"
            ].filter(Boolean);
            return <article key={connection.id} className={`border p-5 ${receivesNewOrders ? "border-black bg-neutral-50" : "border-neutral-300"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold uppercase">{connection.name}</h3>
                  <p className={`mt-2 text-sm font-semibold ${connection.configured ? "text-emerald-700" : "text-amber-700"}`}>{connection.configured ? "Đã có cấu hình kết nối" : "Chưa đủ cấu hình"}</p>
                </div>
                <span className={`border px-3 py-2 text-xs font-semibold uppercase ${receivesNewOrders ? "border-black bg-black text-white" : "border-neutral-300 text-neutral-500"}`}>{receivesNewOrders ? "Đang nhận đơn mới" : "Không nhận đơn mới"}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="border border-neutral-200 p-3">API key<br/><strong>{connection.configuration.apiKey ? "Đã có" : "Chưa có"}</strong></div>
                <div className="border border-neutral-200 p-3">Shop ID<br/><strong>{connection.configuration.shopId ? "Đã có" : "Chưa có"}</strong></div>
                <div className="border border-neutral-200 p-3">Webhook<br/><strong>{connection.configuration.webhookSecret ? "Đã có" : "Chưa có"}</strong></div>
                <div className="border border-neutral-200 p-3">Sản phẩm<br/><strong>{connection.productSync.linkedCount}/{connection.productSync.totalCount}</strong></div>
              </div>
              {missing.length > 0 && <p className="mt-3 text-sm text-amber-700">Còn thiếu: {missing.join(", ")}.</p>}
              <p className="mt-3 text-sm"><strong>Duy trì đơn cũ:</strong> Luôn bật</p>
              <p className="mt-1 break-all text-xs text-neutral-500">Webhook: {connection.webhookUrl}</p>
              <button type="button" onClick={() => setActiveConnection(connection.id)} disabled={receivesNewOrders || !connection.readyForNewOrders || Boolean(busy)} className="mt-4 h-11 border border-black px-5 text-xs font-semibold uppercase disabled:cursor-not-allowed disabled:border-neutral-300 disabled:text-neutral-400">
                {receivesNewOrders ? "Đang được chọn" : connection.readyForNewOrders ? "Chuyển đơn mới sang shop này" : "Chưa đủ điều kiện nhận đơn"}
              </button>
            </article>;
          })}
        </div>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="border border-black p-5">
          <h2 className="text-lg font-semibold uppercase">API Key / Token · {activeConnectionDetails?.name}</h2>
          <p className="mt-2 text-sm text-neutral-600">Khóa được đọc từ Vercel và không hiển thị hoặc lưu trong trang admin.</p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            {([['API_KEY', activeConnectionDetails?.configuration.apiKey], ['TOKEN', activeConnectionDetails?.configuration.token], ['SHOP_ID', activeConnectionDetails?.configuration.shopId], ['WEBHOOK_SECRET', activeConnectionDetails?.configuration.webhookSecret]] as Array<[string, boolean | undefined]>).map(([suffix, ready]) => {
              const name = `${activeConnectionPrefix}_${suffix}`;
              return <div key={name} className="border p-3"><strong className="block text-xs">{name}</strong><span className={ready ? "text-green-700" : "text-red-600"}>{ready ? "Đã cấu hình" : suffix === "TOKEN" ? "Không bắt buộc" : "Chưa có"}</span></div>;
            })}
          </div>
          <p className="mt-3 break-all text-xs text-neutral-500">API: {activeConnectionDetails?.configuration.baseUrl}</p>
          <p className={`mt-3 text-sm font-semibold ${displayedStorage.persistent ? "text-green-700" : "text-red-600"}`}>Lưu đơn lâu dài: {displayedStorage.persistent ? displayedStorage.database ? "Cơ sở dữ liệu" : "Vercel Blob mã hóa" : "Chưa cấu hình"}</p>
          <button onClick={() => action("test")} disabled={Boolean(busy)} className="mt-4 h-11 bg-black px-5 text-xs uppercase text-white disabled:opacity-50">{busy === "test" ? "Đang kiểm tra..." : "Kiểm tra kết nối"}</button>
        </div>
        <div className="border border-black p-5">
          <h2 className="text-lg font-semibold uppercase">Webhook / Đồng bộ định kỳ</h2>
          <p className="mt-2 text-sm text-neutral-600">Webhook cập nhật trạng thái đơn; đồng bộ định kỳ dùng khi Pancake không gửi webhook.</p>
          <code className="mt-4 block break-all bg-neutral-100 p-3 text-xs">{activeConnectionDetails?.webhookUrl}</code>
          <p className="mt-3 text-sm">Hàng đợi đang chờ: <strong>{displayedQueueCount}</strong></p>
        </div>
      </section>

      <section className="mt-6 border border-black p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold uppercase">Nguồn đơn đẩy sang Pancake</h2>
            <p className="mt-2 text-sm text-neutral-600">Website sẽ tự tìm nguồn tên <strong>{displayedOrderSource?.targetName || "facebook"}</strong> trong Pancake và gắn vào đơn khi tạo POS.</p>
          </div>
          <button onClick={() => action("order-sources")} disabled={Boolean(busy)} className="h-11 border border-black px-5 text-xs uppercase disabled:opacity-50">{busy === "order-sources" ? "Đang đọc..." : "Đọc lại nguồn đơn"}</button>
        </div>
        {displayedOrderSource?.error && <p className="mt-3 border border-red-200 bg-red-50 p-3 text-sm text-red-700">{displayedOrderSource.error}</p>}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="border border-neutral-300 p-3">
            <p className="text-xs uppercase text-neutral-500">Nguồn đang khớp</p>
            {displayedOrderSource?.matched ? <p className="mt-2 text-sm"><strong>{displayedOrderSource.matched.name}</strong> · ID <span className="font-mono">{displayedOrderSource.matched.id}</span>{displayedOrderSource.matched.pageId ? <> · Page <span className="font-mono">{displayedOrderSource.matched.pageId}</span></> : null}</p> : <p className="mt-2 text-sm text-red-600">Chưa tìm thấy nguồn cấu hình trong dữ liệu API trả về.</p>}
          </div>
          <div className="border border-neutral-300 p-3">
            <p className="text-xs uppercase text-neutral-500">Cấu hình dự phòng</p>
            <p className="mt-2 text-sm">Tên: <strong>{displayedOrderSource?.targetName || "facebook"}</strong></p>
            <p className="mt-1 text-sm">ID cố định: <strong>{displayedOrderSource?.targetId || "Chưa set"}</strong></p>
          </div>
        </div>
        <div className="mt-4 max-h-56 overflow-auto border border-neutral-200">
          {(displayedOrderSource?.sources || []).length ? (displayedOrderSource?.sources || []).map((source) => <div key={`${source.id}-${source.name}`} className="grid gap-1 border-b border-neutral-100 p-3 text-sm md:grid-cols-[1fr_1fr_1fr]">
            <span><strong>{source.name}</strong></span>
            <span>ID <span className="font-mono">{source.id}</span></span>
            <span>{source.pageId ? <>Page <span className="font-mono">{source.pageId}</span></> : "Không có page_id"}</span>
          </div>) : <p className="p-3 text-sm text-neutral-500">Chưa đọc được danh sách nguồn đơn từ Pancake.</p>}
        </div>
      </section>

      <section className="mt-6 border border-black p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-semibold uppercase">Liên kết từng sản phẩm</h2><p className="mt-1 text-sm text-neutral-600">Đã liên kết {linkedCount}/{rowCount} dòng. Bấm Liên kết ở đúng phân loại, màu và size rồi chọn sản phẩm có sẵn trong Pancake POS.</p></div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => action("recover-links")} disabled={Boolean(busy)} className="h-11 border border-black px-5 text-xs uppercase disabled:opacity-50">{busy === "recover-links" ? "Đang khôi phục..." : "Khôi phục liên kết"}</button>
            <button onClick={() => action("sync-inventory")} disabled={Boolean(busy)} className="h-11 bg-black px-5 text-xs uppercase text-white disabled:opacity-50">{busy === "sync-inventory" ? "Đang kiểm tra..." : "Kiểm tra liên kết SKU"}</button>
          </div>
        </div>

        <div className="mt-5 grid gap-3">
          {displayedProducts.map((product) => {
            const isExpanded = expandedProductId === product.id;
            const productLinkedCount = product.rows.filter((row) => row.linked).length;
            return <article key={product.id} className="border border-neutral-300">
            <button type="button" onClick={() => toggleProduct(product.id)} aria-expanded={isExpanded} className="flex w-full items-center justify-between gap-4 bg-neutral-100 px-4 py-4 text-left">
              <span><strong className="block uppercase">{product.name}</strong><small className="mt-1 block font-normal text-neutral-500">Đã liên kết {productLinkedCount}/{product.rows.length} SKU</small></span>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-black text-2xl font-light leading-none" aria-hidden="true">{isExpanded ? "−" : "+"}</span>
            </button>
            {isExpanded && <div className="divide-y divide-neutral-200 border-t border-neutral-300">
              {product.rows.map((row) => {
                const rowEditorKey = `${product.id}::${row.key}`;
                const isEditing = editingKey === rowEditorKey;
                const isSaving = busy.endsWith(rowEditorKey);
                return <div key={row.key} className="grid gap-3 p-4 lg:grid-cols-[1.1fr_1.3fr_.7fr_auto] lg:items-center">
                  <div>
                    <p className="font-semibold">SKU {row.sku}</p>
                    <p className="mt-1 text-xs text-neutral-500">Size {row.size}</p>
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
                        {filteredVariations.map((variation) => <option key={variation.id} value={variation.id}>{variation.name || "Sản phẩm Pancake"} · SKU {variation.sku || variation.id} · Tồn {variation.quantity}</option>)}
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
            </div>}
          </article>;
          })}
        </div>
      </section>

      <section className="mt-6 border border-black p-5"><h2 className="text-lg font-semibold uppercase">Nhật ký lỗi và đồng bộ</h2><div className="mt-4 grid gap-2">{displayedLogs.length ? displayedLogs.map((log) => <div key={log.id} className="border border-neutral-200 p-3 text-sm"><span className={log.level === "error" ? "text-red-600" : log.level === "warning" ? "text-amber-700" : "text-green-700"}>{log.level.toUpperCase()}</span> · <strong>{log.action}</strong>{log.orderCode ? ` · ${log.orderCode}` : ""}<p className="mt-1">{log.message}</p><time className="mt-1 block text-xs text-neutral-500">{new Date(log.createdAt).toLocaleString("vi-VN")}</time></div>) : <p className="text-sm text-neutral-500">Chưa có nhật ký.</p>}</div></section>
    </main>
  );
}
