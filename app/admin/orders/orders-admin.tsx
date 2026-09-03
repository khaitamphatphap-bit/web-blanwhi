"use client";

import Link from "next/link";
import { shortOrderCode } from "@/lib/order-code";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { IntegrationConfig, ShippingProvider } from "@/lib/integrations";
import { money } from "@/lib/pricing";
import type { PaymentOrphan } from "@/lib/payment-orphans";
import type { OrderStatus, ShippingStatus, ShopOrder } from "@/lib/types";

type OrderStage =
  | "new"
  | "shipping"
  | "delivered"
  | "payment_pending"
  | "paid"
  | "delivery_failed"
  | "returning"
  | "cancelled";

type StorageHealthReport = {
  primaryStore: "database" | "r2" | "vercel_blob" | "local_file";
  database: {
    configured: boolean;
    ok: boolean;
    sizeBytes?: number;
    limitBytes?: number;
    usedPercent?: number;
    warning?: string;
    error?: string;
  };
  r2: {
    configured: boolean;
    ok: boolean;
    warning?: string;
    error?: string;
  };
  local: {
    dataDir: string;
    ok: boolean;
    sizeBytes?: number;
    error?: string;
  };
  orders?: {
    count: number;
    lastCreatedAt?: string;
    lastUpdatedAt?: string;
  };
};

const orderStages: Array<{ value: OrderStage; label: string }> = [
  { value: "new", label: "Đơn mới đặt" },
  { value: "shipping", label: "Đang vận chuyển" },
  { value: "delivered", label: "Đã giao cho khách" },
  { value: "payment_pending", label: "Chờ thanh toán" },
  { value: "paid", label: "Chờ giao hàng" },
  { value: "delivery_failed", label: "Giao hàng thất bại" },
  { value: "returning", label: "Đang hoàn về" },
  { value: "cancelled", label: "Đơn hủy" }
];

const shippingProviders: Array<{ value: ShippingProvider; label: string; endpoint: string }> = [
  {
    value: "ghn",
    label: "Giao Hàng Nhanh",
    endpoint: "https://online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/detail"
  },
  {
    value: "ghtk",
    label: "Giao Hàng Tiết Kiệm",
    endpoint: "https://services.giaohangtietkiem.vn/services/shipment/v2"
  },
  {
    value: "viettelpost",
    label: "ViettelPost",
    endpoint: "https://partner.viettelpost.vn/v2/order/getOrderStatusByOrderNumber"
  },
  {
    value: "shopee_express",
    label: "SPX Express",
    endpoint: ""
  },
  {
    value: "vnpost",
    label: "VNPost",
    endpoint: ""
  },
  {
    value: "custom",
    label: "Đơn vị khác / Proxy riêng",
    endpoint: ""
  }
];

const shippingLabels: Record<ShippingStatus, string> = {
  not_created: "Chưa giao cho ĐVVC",
  awaiting_creation: "Chờ tạo vận đơn",
  finding_driver: "Đang tìm tài xế",
  driver_assigned: "Đã có tài xế",
  ready_to_ship: "Đã tạo vận đơn, chờ bàn giao",
  shipping: "Đang vận chuyển",
  delivered: "Đã giao cho khách",
  delivery_failed: "Giao hàng thất bại",
  returning: "Đang hoàn về",
  returned: "Đang hoàn về",
  cancelled: "Đơn hủy",
  unknown: "Không rõ"
};
const pancakeStatusLabels: Record<NonNullable<ShopOrder["pancakeStatus"]>, string> = { pending_confirmation: "Chờ xác nhận", confirmed: "Đã xác nhận", packing: "Chờ in", shipping: "Đang giao", completed: "Hoàn thành", cancelled: "Hủy", returned: "Hoàn hàng" };

const primaryStoreLabels: Record<StorageHealthReport["primaryStore"], string> = {
  database: "Postgres database",
  r2: "Cloudflare R2 mã hóa",
  vercel_blob: "Vercel Blob mã hóa",
  local_file: "File local tạm"
};

function formatBytes(value?: number) {
  if (!value || value <= 0) return "Chưa có dữ liệu";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

function formatHealthTime(value?: string) {
  if (!value) return "Chưa có";
  return new Date(value).toLocaleString("vi-VN");
}

function storageHealthLevel(health: StorageHealthReport | null) {
  if (!health) return "checking";
  if (health.primaryStore === "local_file") return "danger";
  if (health.primaryStore === "database" && health.database.error) return "danger";
  if (health.primaryStore === "r2" && (!health.r2.configured || !health.r2.ok || health.r2.error)) return "danger";
  if (health.database.warning || health.r2.warning || (health.database.usedPercent || 0) >= 70) return "warning";
  return "ok";
}

function storageHealthClass(level: string) {
  if (level === "ok") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (level === "warning") return "border-amber-300 bg-amber-50 text-amber-900";
  if (level === "danger") return "border-red-300 bg-red-50 text-red-900";
  return "border-neutral-200 bg-neutral-50 text-neutral-800";
}

export function OrdersAdmin({
  initialOrders,
  initialPaymentOrphans,
  initialIntegrations,
  deliveryConfig
}: {
  initialOrders: ShopOrder[];
  initialPaymentOrphans: PaymentOrphan[];
  initialIntegrations: IntegrationConfig;
  deliveryConfig: { provider: "ahamove" | "lalamove"; configured: boolean; senderReady: boolean };
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [paymentOrphans] = useState(initialPaymentOrphans);
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [message, setMessage] = useState("");
  const [busyCode, setBusyCode] = useState("");
  const [autoSyncText, setAutoSyncText] = useState("Tự động cập nhật nền đang bật");
  const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState(false);
  const [lastBackgroundRefresh, setLastBackgroundRefresh] = useState<Date | null>(null);
  const [stageFilter, setStageFilter] = useState<OrderStage | "all">("all");
  const [orderSearch, setOrderSearch] = useState("");
  const [selectedOrderCodes, setSelectedOrderCodes] = useState<string[]>([]);
  const [expandedOrderCode, setExpandedOrderCode] = useState("");
  const [storageHealth, setStorageHealth] = useState<StorageHealthReport | null>(null);
  const [storageHealthBusy, setStorageHealthBusy] = useState(false);
  const orderListRef = useRef<HTMLElement | null>(null);
  const shippingSyncInFlight = useRef(false);
  const filteredOrders = useMemo(() => {
    const search = normalizeSearch(orderSearch);
    return orders.filter((order) => {
      if (stageFilter !== "all" && getOrderStage(order) !== stageFilter) return false;
      if (!search) return true;
      return normalizeSearch([
        order.code,
        shortOrderCode(order.code),
        order.customer.name,
        order.customer.phone
      ].join(" ")).includes(search);
    });
  }, [orders, stageFilter, orderSearch]);
  const sortedOrders = useMemo(() => [...filteredOrders].sort((left, right) => {
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  }), [filteredOrders]);
  const totals = useMemo(() => ({
    revenue: orders.filter((order) => order.status === "paid").reduce((sum, order) => sum + order.total, 0)
  }), [orders]);
  const selectedVisibleCount = sortedOrders.filter((order) => selectedOrderCodes.includes(order.code)).length;
  const allVisibleSelected = sortedOrders.length > 0 && selectedVisibleCount === sortedOrders.length;
  const storageLevel = storageHealthLevel(storageHealth);

  async function refreshOrders({ silent = false }: { silent?: boolean } = {}) {
    if (silent) setIsBackgroundRefreshing(true);
    try {
      const response = await fetch("/api/orders", { cache: "no-store" });
      const data = await response.json();
      const nextOrders = data.orders || [];
      setOrders(nextOrders);
      setSelectedOrderCodes((current) => current.filter((code) => nextOrders.some((order: ShopOrder) => order.code === code)));
      if (silent) setLastBackgroundRefresh(new Date());
    } finally {
      if (silent) setIsBackgroundRefreshing(false);
    }
  }

  async function refreshStorageHealth() {
    setStorageHealthBusy(true);
    try {
      const response = await fetch("/api/admin/storage-health", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không kiểm tra được lưu trữ.");
      setStorageHealth(data);
    } catch (error) {
      setStorageHealth((current) => ({
        ...(current || {}),
        primaryStore: current?.primaryStore || "local_file",
        database: {
          ...(current?.database || { configured: false, ok: false }),
          ok: false,
          error: error instanceof Error ? error.message : "Không kiểm tra được lưu trữ."
        },
        r2: current?.r2 || { configured: false, ok: false },
        local: current?.local || { dataDir: "", ok: false },
        orders: current?.orders
      }));
    } finally {
      setStorageHealthBusy(false);
    }
  }

  async function backupOrdersNow() {
    setStorageHealthBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/storage-health", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không tạo được backup đơn hàng.");
      setMessage(`Đã tạo backup ${data.orders?.count || 0} đơn hàng vào ${data.backup?.location || "kho lưu trữ"}.`);
      await refreshStorageHealth();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không tạo được backup đơn hàng.");
    } finally {
      setStorageHealthBusy(false);
    }
  }

  function selectStage(stage: OrderStage | "all") {
    setStageFilter(stage);
    setExpandedOrderCode("");
    window.requestAnimationFrame(() => {
      orderListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function toggleOrderSelection(code: string) {
    setSelectedOrderCodes((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  }

  function toggleVisibleSelection() {
    const visibleCodes = sortedOrders.map((order) => order.code);
    setSelectedOrderCodes((current) => {
      if (allVisibleSelected) return current.filter((code) => !visibleCodes.includes(code));
      return Array.from(new Set([...current, ...visibleCodes]));
    });
  }

  async function saveIntegrations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const response = await fetch("/api/admin/integrations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(integrations)
    });
    if (!response.ok) {
      setMessage("Không lưu được cấu hình tích hợp.");
      return;
    }
    setIntegrations(await response.json());
    setMessage("Đã lưu cấu hình tích hợp.");
  }

  async function syncOrder(order: ShopOrder, target: "all" | "misa" | "pancake") {
    setBusyCode(`${order.code}-${target}`);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/orders/${order.code}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không đồng bộ được đơn.");
      await refreshOrders();
      setMessage(`Đã đồng bộ ${order.code}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không đồng bộ được đơn.");
    } finally {
      setBusyCode("");
    }
  }

  async function manageExpress(order: ShopOrder, action: "create" | "track" | "cancel") {
    setBusyCode(`${order.code}-express-${action}`);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/orders/${order.code}/express`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không xử lý được vận đơn hỏa tốc.");
      await refreshOrders();
      setMessage(action === "create" ? `Đã tạo vận đơn hỏa tốc ${order.code}.` : action === "cancel" ? `Đã hủy vận đơn hỏa tốc ${order.code}.` : `Đã cập nhật vận đơn hỏa tốc ${order.code}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không xử lý được vận đơn hỏa tốc.");
    } finally {
      setBusyCode("");
    }
  }

  async function updateShipping(order: ShopOrder) {
    if (order.deliveryType === "express") return manageExpress(order, order.deliveryOrderId ? "track" : "create");
    setBusyCode(`${order.code}-shipping`);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/orders/${order.code}/shipping`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không cập nhật được vận chuyển.");
      await refreshOrders();
      setMessage(`Đã cập nhật vận chuyển ${order.code}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không cập nhật được vận chuyển.");
    } finally {
      setBusyCode("");
    }
  }

  async function updateAllShipping(silent = false, full = false) {
    if (shippingSyncInFlight.current) {
      if (!silent) setMessage("Đồng bộ vận chuyển đang chạy, vui lòng chờ hoàn tất.");
      return;
    }
    shippingSyncInFlight.current = true;
    if (!silent) {
      setBusyCode("all-shipping");
      setMessage("");
    }
    try {
      const response = await fetch(`/api/admin/orders/shipping-sync${!silent || full ? "?full=1" : ""}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không cập nhật được vận chuyển.");
      await refreshOrders({ silent });
      const text = `Đã kiểm tra ${data.checked || 0} đơn, đọc chi tiết ${data.ordersDetailed || 0} đơn: ${data.ordersUpdated || 0} đơn có thay đổi, tự chuyển ${data.posStatusesUpdated || 0} trạng thái POS, ${(data.failed || 0) + (data.detailErrors || 0) + (data.posStatusErrors || 0)} lỗi.`;
      setAutoSyncText(`Tự động cập nhật nền: ${text}`);
      if (!silent) setMessage(text);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Không cập nhật được vận chuyển.";
      setAutoSyncText(`Tự động cập nhật nền: ${text}`);
      if (!silent) setMessage(text);
    } finally {
      shippingSyncInFlight.current = false;
      if (!silent) setBusyCode("");
    }
  }

  async function cancelOrder(order: ShopOrder) {
    if (!window.confirm(`Bạn có chắc chắn muốn hủy đơn ${shortOrderCode(order.code)} không?`)) return;
    setBusyCode(`${order.code}-cancel`);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/orders/${encodeURIComponent(order.code)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Admin hủy đơn" })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không hủy được đơn.");
      setOrders((current) => current.map((item) => item.code === order.code ? data.order : item));
      setMessage(`Đã hủy đơn ${shortOrderCode(order.code)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không hủy được đơn.");
    } finally {
      setBusyCode("");
    }
  }

  async function deleteOrders(codes: string[]) {
    const uniqueCodes = Array.from(new Set(codes)).filter(Boolean);
    if (!uniqueCodes.length) return;
    const label = uniqueCodes.length === 1 ? `đơn ${shortOrderCode(uniqueCodes[0])}` : `${uniqueCodes.length} đơn đã chọn`;
    if (!window.confirm(`Bạn có chắc chắn muốn xóa mất ${label} khỏi trang admin không?`)) return;
    if (uniqueCodes.length > 1 && !window.confirm("Xóa hàng loạt sẽ làm danh sách gọn lại nhưng đơn sẽ biến mất khỏi trang admin. Bạn xác nhận lần nữa nhé?")) return;

    setBusyCode(uniqueCodes.length === 1 ? `${uniqueCodes[0]}-delete` : "bulk-delete");
    setMessage("");
    try {
      const response = await fetch("/api/admin/orders/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: uniqueCodes })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không xóa được đơn.");
      setOrders(data.orders || []);
      setSelectedOrderCodes((current) => current.filter((code) => !uniqueCodes.includes(code)));
      if (uniqueCodes.includes(expandedOrderCode)) setExpandedOrderCode("");
      setMessage(`Đã xóa ${data.deletedCount || uniqueCodes.length} đơn khỏi trang admin.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không xóa được đơn.");
    } finally {
      setBusyCode("");
    }
  }

  useEffect(() => {
    updateAllShipping(true, true).catch(() => undefined);
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      refreshOrders({ silent: true }).catch(() => undefined);
    }, 10000);
    const shippingTimer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      updateAllShipping(true).catch(() => undefined);
    }, 15000);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(shippingTimer);
    };
  }, []);

  useEffect(() => {
    if (!expandedOrderCode) return;
    const order = orders.find((item) => item.code === expandedOrderCode);
    if (!order || order.deliveryType === "express" || order.status === "cancelled") return;
    updateShipping(order).catch(() => undefined);
  }, [expandedOrderCode]);

  useEffect(() => {
    refreshStorageHealth().catch(() => undefined);
    const healthTimer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      refreshStorageHealth().catch(() => undefined);
    }, 60000);
    return () => window.clearInterval(healthTimer);
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-7xl bg-white px-6 py-10 md:my-12 md:px-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <Link href="/" className="text-xs uppercase text-neutral-500">BLANWHI</Link>
          <h1 className="mt-3 text-4xl font-medium">Quản trị đơn hàng</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/site" className="h-10 border border-neutral-300 px-4 pt-2 text-xs uppercase">Admin website</Link>
          <button onClick={() => updateAllShipping()} disabled={busyCode === "all-shipping"} className="h-10 border border-black bg-black px-4 text-xs uppercase text-white disabled:opacity-50">Cập nhật tất cả VC</button>
          <button onClick={() => refreshOrders()} className="h-10 border border-black px-4 text-xs uppercase">Tải lại đơn</button>
        </div>
      </header>

      {message && <p className="mt-4 border border-neutral-200 bg-neutral-50 p-3 text-sm">{message}</p>}
      {paymentOrphans.length > 0 && (
        <section className="mt-4 border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p className="text-xs font-semibold uppercase">Cảnh báo thanh toán cần xử lý</p>
          <h2 className="mt-1 text-xl font-medium">Có {paymentOrphans.length} giao dịch đã báo tiền nhưng thiếu đơn hợp lệ</h2>
          <div className="mt-3 grid gap-2">
            {paymentOrphans.slice(0, 8).map((payment) => (
              <div key={payment.id} className="grid gap-2 border border-red-200 bg-white/70 p-3 md:grid-cols-5">
                <div>
                  <p className="text-xs uppercase opacity-70">Mã đơn</p>
                  <strong>{shortOrderCode(payment.orderCode) || payment.orderCode || "Không rõ"}</strong>
                </div>
                <div>
                  <p className="text-xs uppercase opacity-70">Cổng</p>
                  <strong className="uppercase">{payment.provider}</strong>
                </div>
                <div>
                  <p className="text-xs uppercase opacity-70">Số tiền</p>
                  <strong>{money(payment.amount)}</strong>
                </div>
                <div>
                  <p className="text-xs uppercase opacity-70">Mã giao dịch</p>
                  <strong className="break-all">{payment.transactionId || payment.appTransId || "Đang cập nhật"}</strong>
                </div>
                <div>
                  <p className="text-xs uppercase opacity-70">Lý do</p>
                  <strong>{payment.reason === "order_not_found" ? "Không tìm thấy đơn" : "Lệch số tiền"}</strong>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs">Các dòng này là biên nhận bảo vệ khi ZaloPay báo thanh toán thành công nhưng website không ghép được vào đơn. Cần đối chiếu ZaloPay/Pancake hoặc liên hệ khách để lấy địa chỉ nếu đơn gốc đã mất.</p>
        </section>
      )}
      <p className="mt-4 border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        {autoSyncText}. Dữ liệu đơn được cập nhật nền mỗi 10 giây, không reload trang, không tự cuộn và không đóng đơn đang mở.
        {lastBackgroundRefresh && <span> Lần cập nhật gần nhất: {lastBackgroundRefresh.toLocaleTimeString("vi-VN")}.</span>}
        {isBackgroundRefreshing && <span> Đang kiểm tra dữ liệu mới...</span>}
      </p>

      <section className={`mt-4 border p-4 ${storageHealthClass(storageLevel)}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase">An toàn dữ liệu đơn hàng</p>
            <h2 className="mt-1 text-2xl font-medium">
              {storageLevel === "ok" ? "Đang an toàn" : storageLevel === "danger" ? "Cần xử lý trước khi bán mạnh" : storageLevel === "warning" ? "Cần theo dõi" : "Đang kiểm tra"}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={refreshStorageHealth} disabled={storageHealthBusy} className="h-10 border border-current px-4 text-xs uppercase disabled:opacity-50">Kiểm tra lại</button>
            <button onClick={backupOrdersNow} disabled={storageHealthBusy} className="h-10 border border-black bg-black px-4 text-xs uppercase text-white disabled:opacity-50">Backup đơn ngay</button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-4">
          <div className="border border-current/20 bg-white/55 p-3">
            <p className="text-xs uppercase opacity-70">Kho chính</p>
            <strong className="mt-1 block">{storageHealth ? primaryStoreLabels[storageHealth.primaryStore] : "Đang kiểm tra"}</strong>
          </div>
          <div className="border border-current/20 bg-white/55 p-3">
            <p className="text-xs uppercase opacity-70">Database</p>
            <strong className="mt-1 block">{storageHealth?.database.ok ? "Kết nối OK" : storageHealth?.database.configured ? "Có cấu hình nhưng lỗi" : "Chưa có DATABASE_URL"}</strong>
            <span className="mt-1 block text-xs opacity-80">{storageHealth?.database.usedPercent !== undefined ? `Đã dùng ${storageHealth.database.usedPercent}% · ${formatBytes(storageHealth.database.sizeBytes)}` : formatBytes(storageHealth?.database.sizeBytes)}</span>
          </div>
          <div className="border border-current/20 bg-white/55 p-3">
            <p className="text-xs uppercase opacity-70">R2 backup/ảnh</p>
            <strong className="mt-1 block">{storageHealth?.r2.ok ? "Ghi được" : storageHealth?.r2.configured ? "Có cấu hình nhưng lỗi" : "Chưa cấu hình"}</strong>
            <span className="mt-1 block text-xs opacity-80">{storageHealth?.r2.error || storageHealth?.r2.warning || "Dùng làm kho dự phòng và kho ảnh."}</span>
          </div>
          <div className="border border-current/20 bg-white/55 p-3">
            <p className="text-xs uppercase opacity-70">Đơn hàng</p>
            <strong className="mt-1 block">{storageHealth?.orders?.count ?? orders.length} đơn</strong>
            <span className="mt-1 block text-xs opacity-80">Mới nhất: {formatHealthTime(storageHealth?.orders?.lastCreatedAt || orders[0]?.createdAt)}</span>
          </div>
        </div>
        {(storageHealth?.database.warning || storageHealth?.database.error || storageHealth?.r2.warning || storageHealth?.r2.error || storageHealth?.primaryStore === "local_file") && (
          <div className="mt-3 space-y-1 text-sm">
            {storageHealth.primaryStore === "local_file" && <p>Đang dùng file local tạm. Khi chạy production phải cấu hình DATABASE_URL để đơn không phụ thuộc server tạm.</p>}
            {storageHealth.database.warning && <p>{storageHealth.database.warning}</p>}
            {storageHealth.database.error && <p>{storageHealth.database.error}</p>}
            {storageHealth.r2.warning && <p>{storageHealth.r2.warning}</p>}
            {storageHealth.r2.error && <p>{storageHealth.r2.error}</p>}
          </div>
        )}
      </section>

      <section className="mt-6 grid gap-3 md:grid-cols-3 lg:grid-cols-9">
        {orderStages.map((stage) => (
          <Metric
            key={stage.value}
            active={stageFilter === stage.value}
            label={stage.label}
            value={orders.filter((order) => getOrderStage(order) === stage.value).length}
            onClick={() => selectStage(stage.value)}
          />
        ))}
      </section>
      <div className="mt-3 flex flex-wrap items-center gap-3 border border-neutral-200 p-4">
        <span className="text-sm text-neutral-600">
          Đang xem: {stageFilter === "all" ? "Tất cả đơn" : orderStageLabel(stageFilter)} · {sortedOrders.length} đơn
        </span>
        <input
          value={orderSearch}
          onChange={(event) => setOrderSearch(event.target.value)}
          placeholder="Tìm theo tên khách hoặc mã đơn"
          className="h-10 min-w-72 flex-1 border border-neutral-300 px-3 text-sm"
        />
        {stageFilter !== "all" && (
          <button onClick={() => selectStage("all")} className="h-9 border border-black px-4 text-xs uppercase">Tất cả đơn</button>
        )}
        {orderSearch && (
          <button onClick={() => setOrderSearch("")} className="h-9 border border-neutral-300 px-4 text-xs uppercase">Xóa tìm kiếm</button>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 border border-neutral-200 bg-neutral-50 p-4">
        <button onClick={toggleVisibleSelection} disabled={!sortedOrders.length} className="h-9 border border-black px-4 text-xs uppercase disabled:opacity-40">
          {allVisibleSelected ? "Bỏ chọn đang xem" : "Chọn tất cả đang xem"}
        </button>
        <button onClick={() => setSelectedOrderCodes([])} disabled={!selectedOrderCodes.length} className="h-9 border border-neutral-300 px-4 text-xs uppercase disabled:opacity-40">Bỏ chọn tất cả</button>
        <button onClick={() => deleteOrders(selectedOrderCodes)} disabled={!selectedOrderCodes.length || busyCode === "bulk-delete"} className="h-9 border border-red-600 bg-red-600 px-4 text-xs uppercase text-white disabled:opacity-40">Xóa đơn đã chọn</button>
        <span className="text-sm text-neutral-600">Đã chọn {selectedOrderCodes.length} đơn</span>
      </div>
      <section className="mt-3 border border-neutral-200 p-4">
        <p className="text-xs uppercase text-neutral-500">Doanh thu đã thanh toán</p>
        <strong className="mt-1 block text-3xl font-medium">{money(totals.revenue)}</strong>
      </section>

      <form onSubmit={saveIntegrations} className="mt-8 grid gap-4 border border-neutral-200 p-4 lg:grid-cols-3">
        <fieldset className="border border-neutral-200 p-4">
          <legend className="px-2 text-sm font-semibold uppercase">Pancake POS</legend>
          <p className="mt-2 text-sm text-neutral-600">API Key, Token và Secret được lưu trong Environment Variables, không lưu tại trình duyệt hoặc file cấu hình admin.</p>
          <Link href="/admin/pancake" className="mt-4 inline-block border border-black bg-black px-4 py-3 text-xs uppercase text-white">Mở Pancake Integration</Link>
        </fieldset>
        <IntegrationBox
          title="MISA eShop"
          enabled={integrations.misa.enabled}
          endpoint={integrations.misa.endpoint}
          inventoryEndpoint={integrations.misa.inventoryEndpoint}
          token={integrations.misa.token}
          endpointPlaceholder="https://.../misa/orders"
          onChange={(patch) => setIntegrations({ ...integrations, misa: { ...integrations.misa, ...patch } })}
        />
        <fieldset className="border border-neutral-200 p-4">
          <legend className="px-2 text-sm font-semibold uppercase">Vận chuyển</legend>
          <label className="mt-2 block text-sm"><input type="checkbox" checked={integrations.shipping.enabled} onChange={(event) => setIntegrations({ ...integrations, shipping: { ...integrations.shipping, enabled: event.target.checked } })} className="mr-2" />Bật cập nhật API vận chuyển</label>
          <select
            value={integrations.shipping.provider}
            onChange={(event) => {
              const provider = event.target.value as ShippingProvider;
              const selected = shippingProviders.find((item) => item.value === provider);
              setIntegrations({
                ...integrations,
                shipping: {
                  ...integrations.shipping,
                  provider,
                  providerName: selected?.label || integrations.shipping.providerName,
                  statusEndpoint: selected?.endpoint || integrations.shipping.statusEndpoint
                }
              });
            }}
            className="mt-3 h-10 w-full border px-3 text-sm"
          >
            {shippingProviders.map((provider) => (
              <option key={provider.value} value={provider.value}>{provider.label}</option>
            ))}
          </select>
          {integrations.shipping.provider === "custom" && (
            <input value={integrations.shipping.providerName} onChange={(event) => setIntegrations({ ...integrations, shipping: { ...integrations.shipping, providerName: event.target.value } })} placeholder="Tên đơn vị vận chuyển" className="mt-2 h-10 w-full border px-3 text-sm" />
          )}
          <input value={integrations.shipping.statusEndpoint} onChange={(event) => setIntegrations({ ...integrations, shipping: { ...integrations.shipping, statusEndpoint: event.target.value } })} placeholder="Endpoint trạng thái vận đơn / proxy API" className="mt-2 h-10 w-full border px-3 text-sm" />
          <input value={integrations.shipping.token} onChange={(event) => setIntegrations({ ...integrations, shipping: { ...integrations.shipping, token: event.target.value } })} placeholder="API token vận chuyển" className="mt-2 h-10 w-full border px-3 text-sm" />
          <input value={integrations.shipping.shopId} onChange={(event) => setIntegrations({ ...integrations, shipping: { ...integrations.shipping, shopId: event.target.value } })} placeholder="Shop ID nếu hãng yêu cầu" className="mt-2 h-10 w-full border px-3 text-sm" />
          <input value={integrations.shipping.clientId} onChange={(event) => setIntegrations({ ...integrations, shipping: { ...integrations.shipping, clientId: event.target.value } })} placeholder="Client ID / mã khách hàng nếu có" className="mt-2 h-10 w-full border px-3 text-sm" />
        </fieldset>
        <fieldset className="border border-neutral-200 p-4">
          <legend className="px-2 text-sm font-semibold uppercase">Giao hỏa tốc</legend>
          <div className="mt-2 space-y-2 text-sm">
            <p><b>Đơn vị:</b> {deliveryConfig.provider === "ahamove" ? "Ahamove" : "Lalamove"}</p>
            <p className={deliveryConfig.configured ? "text-emerald-700" : "text-amber-700"}>{deliveryConfig.configured ? "API Key/Secret đã được cấu hình." : "Chưa có DELIVERY_API_KEY/DELIVERY_SECRET."}</p>
            <p className={deliveryConfig.senderReady ? "text-emerald-700" : "text-amber-700"}>{deliveryConfig.senderReady ? "Địa chỉ và tọa độ kho đã sẵn sàng." : "Thiếu thông tin điểm lấy hàng trong Environment Variables."}</p>
            <p className="text-xs leading-5 text-neutral-500">Khóa API chỉ lưu trong Vercel Environment Variables, không hiển thị hoặc lưu trong trang admin.</p>
          </div>
        </fieldset>
        <PaymentMerchantBox
          title="VNPAY merchant"
          enabled={integrations.payment.vnpay.enabled}
          fields={[
            { label: "TMN Code", value: integrations.payment.vnpay.tmnCode, keyName: "tmnCode", placeholder: "Mã website/terminal VNPAY" },
            { label: "Hash secret", value: integrations.payment.vnpay.hashSecret, keyName: "hashSecret", placeholder: "Chuỗi bí mật VNPAY" },
            { label: "Payment URL", value: integrations.payment.vnpay.paymentUrl, keyName: "paymentUrl", placeholder: "https://pay.vnpay.vn/vpcpay.html" }
          ]}
          onEnabled={(enabled) => setIntegrations({ ...integrations, payment: { ...integrations.payment, vnpay: { ...integrations.payment.vnpay, enabled } } })}
          onField={(key, value) => setIntegrations({ ...integrations, payment: { ...integrations.payment, vnpay: { ...integrations.payment.vnpay, [key]: value } } })}
        />
        <PaymentMerchantBox
          title="MoMo merchant"
          enabled={integrations.payment.momo.enabled}
          fields={[
            { label: "Partner code", value: integrations.payment.momo.partnerCode, keyName: "partnerCode", placeholder: "Mã đối tác MoMo" },
            { label: "Access key", value: integrations.payment.momo.accessKey, keyName: "accessKey", placeholder: "Access key" },
            { label: "Secret key", value: integrations.payment.momo.secretKey, keyName: "secretKey", placeholder: "Secret key" },
            { label: "Endpoint", value: integrations.payment.momo.endpoint, keyName: "endpoint", placeholder: "https://payment.momo.vn/v2/gateway/api/create" }
          ]}
          onEnabled={(enabled) => setIntegrations({ ...integrations, payment: { ...integrations.payment, momo: { ...integrations.payment.momo, enabled } } })}
          onField={(key, value) => setIntegrations({ ...integrations, payment: { ...integrations.payment, momo: { ...integrations.payment.momo, [key]: value } } })}
        />
        <PaymentMerchantBox
          title="ZaloPay merchant"
          enabled={integrations.payment.zalopay.enabled}
          fields={[
            { label: "App ID", value: integrations.payment.zalopay.appId, keyName: "appId", placeholder: "App ID ZaloPay" },
            { label: "Key 1", value: integrations.payment.zalopay.key1, keyName: "key1", placeholder: "Key tạo thanh toán" },
            { label: "Key 2", value: integrations.payment.zalopay.key2, keyName: "key2", placeholder: "Key kiểm callback/IPN" },
            { label: "Endpoint", value: integrations.payment.zalopay.endpoint, keyName: "endpoint", placeholder: "https://openapi.zalopay.vn/v2/create" }
          ]}
          onEnabled={(enabled) => setIntegrations({ ...integrations, payment: { ...integrations.payment, zalopay: { ...integrations.payment.zalopay, enabled } } })}
          onField={(key, value) => setIntegrations({ ...integrations, payment: { ...integrations.payment, zalopay: { ...integrations.payment.zalopay, [key]: value } } })}
        />
        <div className="lg:col-span-3">
          <button className="h-10 bg-black px-5 text-xs uppercase text-white">Lưu cấu hình tích hợp</button>
          <p className="mt-3 text-xs leading-5 text-neutral-500">
            Webhook nhận trạng thái: /api/webhooks/shipping · /api/webhooks/misa · /api/webhooks/pancake · /api/payments/vnpay-ipn · /api/payments/momo-ipn · /api/payments/zalopay-ipn
          </p>
        </div>
      </form>

      <section ref={orderListRef} className="mt-8 scroll-mt-6 space-y-3">
        {sortedOrders.map((order) => {
          const isOpen = expandedOrderCode === order.code;
          return (
            <article key={order.id} className="border border-neutral-200 bg-white">
              <div className="grid gap-4 p-4 lg:grid-cols-[1.15fr_1fr_1fr_.8fr_auto] lg:items-center">
                <div>
                  <label className="mb-2 flex items-center gap-2 text-xs uppercase text-neutral-500">
                    <input type="checkbox" checked={selectedOrderCodes.includes(order.code)} onChange={() => toggleOrderSelection(order.code)} />
                    Chọn đơn
                  </label>
                  <Link href={`/payment-result?orderCode=${order.code}&from=admin`} className="border-b border-black text-sm font-semibold">{shortOrderCode(order.code)}</Link>
                  <div className="mt-1 text-xs text-neutral-500">{new Date(order.createdAt).toLocaleString("vi-VN")}</div>
                  <span className={`mt-3 inline-flex border px-2 py-1 text-xs uppercase ${orderStageClass(getOrderStage(order))}`}>{orderStageLabel(getOrderStage(order))}</span>
                </div>
                <div>
                  <div className="text-xs uppercase text-neutral-500">Người mua</div>
                  <div className="mt-1 font-medium">{order.customer.name}</div>
                  <a href={`tel:${order.customer.phone}`} className="text-sm text-neutral-600">{order.customer.phone}</a>
                  <div className="mt-1 text-sm text-neutral-700">{order.customer.address}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-neutral-500">Hàng hóa</div>
                  <div className="mt-1 font-medium">{order.items.length} mẫu · {order.items.reduce((sum, item) => sum + item.quantity, 0)} sản phẩm</div>
                  <div className="mt-1 text-sm text-neutral-600">{orderSummary(order)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-neutral-500">Thanh toán</div>
                  <div className="mt-1 uppercase">{order.paymentMethod}</div>
                  <span className={`mt-2 inline-flex border px-2 py-1 text-xs uppercase ${paymentStatusClass(order.status, order.paymentMethod)}`}>{paymentLabel(order.status, order.paymentMethod)}</span>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <button onClick={() => setExpandedOrderCode(isOpen ? "" : order.code)} className="h-9 border border-black px-3 text-xs uppercase">{isOpen ? "Đóng" : "Chi tiết"}</button>
                  <button onClick={() => updateShipping(order)} disabled={busyCode.startsWith(order.code)} className="h-9 border border-neutral-300 px-3 text-xs uppercase disabled:opacity-50">Cập nhật VC</button>
                  <button onClick={() => cancelOrder(order)} disabled={!canCancelOrder(order) || busyCode.startsWith(order.code)} className="h-9 border border-red-500 px-3 text-xs uppercase text-red-600 disabled:cursor-not-allowed disabled:opacity-40">Hủy đơn</button>
                  <button onClick={() => deleteOrders([order.code])} disabled={busyCode.startsWith(order.code)} className="h-9 border border-red-700 bg-red-700 px-3 text-xs uppercase text-white disabled:opacity-40">Xóa</button>
                </div>
              </div>
              {isOpen && (
                <div className="grid gap-5 border-t border-neutral-200 bg-neutral-50 p-4 lg:grid-cols-3">
                  <section>
                    <h3 className="text-xs font-semibold uppercase text-neutral-500">Thông tin khách</h3>
                    <div className="mt-3 space-y-2 text-sm">
                      <p><b>Tên:</b> {order.customer.name}</p>
                      <p><b>SĐT:</b> {order.customer.phone}</p>
                      <p><b>Địa chỉ:</b> {order.customer.address}</p>
                      <p><b>Ghi chú:</b> {order.customer.note || "Không có"}</p>
                    </div>
                  </section>
                  <section>
                    <h3 className="text-xs font-semibold uppercase text-neutral-500">Chi tiết hàng hóa</h3>
                    <div className="mt-3 space-y-3">
                      {order.items.map((item) => (
                        <div key={`${order.code}-${item.productId}-${item.size}-${item.color}`} className="border border-neutral-200 bg-white p-3 text-sm">
                          <b>{item.name}</b>
                          <div className="mt-1 text-neutral-600">Màu: {item.color || "Không màu"} · Size: {item.size || "Không size"}</div>
                          <div className="mt-1 text-neutral-600">SL: {item.quantity} · Đơn giá: {money(item.unitPrice)} · Thành tiền: {money(item.quantity * item.unitPrice)}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section>
                    <h3 className="text-xs font-semibold uppercase text-neutral-500">Thanh toán & vận chuyển</h3>
                    <div className="mt-3 space-y-2 text-sm">
                      <p><b>Giá trị đơn hàng:</b> {money(order.subtotal)}</p>
                      <p><b>Giảm giá:</b> -{money(order.discount)}</p>
                      <p><b>Ship:</b> {order.shippingFeeLabel || money(order.shipping)}</p>
                      <p><b>Tổng:</b> {money(order.total)}</p>
                      <p><b>Mã giao dịch:</b> {order.transactionId || "Chưa có"}</p>
                      {order.paymentMethod === "zalopay" && (
                        <div className="border border-neutral-200 bg-white p-3">
                          <p><b>Hoàn tiền ZaloPay:</b> {refundStatusLabel(order.refundStatus)}</p>
                          {order.refundAmount !== undefined && <p><b>Số tiền hoàn:</b> {money(order.refundAmount)}</p>}
                          {order.refundTransactionId && <p><b>Mã yêu cầu hoàn:</b> {order.refundTransactionId}</p>}
                          {order.refundMessage && <p className="text-neutral-600">{order.refundMessage}</p>}
                        </div>
                      )}
                      <p><b>Vận chuyển:</b> {order.shippingCarrier || "Chưa chọn"} · {order.shippingMethod || "Giao nhanh"}</p>
                      <p><b>Mã vận đơn:</b> {order.trackingCode || "Chưa có"}</p>
                      <span className={`inline-flex border px-2 py-1 text-xs uppercase ${shippingStatusClass(order.shippingStatus || "not_created")}`}>
                        {shippingLabelForOrder(order)}
                      </span>
                      {order.shippingMessage && <p className="text-neutral-600">{order.shippingMessage}</p>}
                      {order.deliveryType === "express" && (
                        <div className="mt-3 space-y-2 border border-blue-200 bg-blue-50 p-3">
                          <p className="font-semibold text-blue-900">🚀 Giao hỏa tốc</p>
                          {!order.deliveryOrderId ? (
                            <button onClick={() => manageExpress(order, "create")} disabled={busyCode === `${order.code}-express-create`} className="h-10 w-full bg-black px-3 text-xs uppercase text-white disabled:opacity-50">🚀 Tạo vận đơn hỏa tốc</button>
                          ) : (
                            <div className="grid gap-2 sm:grid-cols-2">
                              <button onClick={() => manageExpress(order, "track")} disabled={busyCode === `${order.code}-express-track`} className="h-9 border border-black bg-white px-3 text-xs uppercase disabled:opacity-50">Cập nhật hỏa tốc</button>
                              {!["shipping", "delivered", "cancelled"].includes(order.shippingStatus || "") && (
                                <button onClick={() => manageExpress(order, "cancel")} disabled={busyCode === `${order.code}-express-cancel`} className="h-9 border border-red-500 bg-white px-3 text-xs uppercase text-red-600 disabled:opacity-50">Hủy vận đơn</button>
                              )}
                            </div>
                          )}
                          {order.deliveryOrderId && <p><b>Mã đơn giao:</b> {order.deliveryOrderId}</p>}
                          {order.deliveryDriver && <p><b>Tài xế:</b> {order.deliveryDriver.name || order.deliveryDriver.id || "Đang cập nhật"}{order.deliveryDriver.phone ? ` · ${order.deliveryDriver.phone}` : ""}{order.deliveryDriver.plateNumber ? ` · ${order.deliveryDriver.plateNumber}` : ""}</p>}
                          {order.deliveryFeeActual !== undefined && <p><b>Phí thực tế:</b> {money(order.deliveryFeeActual)}</p>}
                          {order.deliveryTrackingUrl && <a href={order.deliveryTrackingUrl} target="_blank" rel="noreferrer" className="inline-block border-b border-blue-800 text-blue-800">Mở link theo dõi →</a>}
                        </div>
                      )}
                      <div className="grid gap-2 pt-2 sm:grid-cols-2">
                        <button onClick={() => syncOrder(order, "pancake")} disabled={busyCode === `${order.code}-pancake`} className="h-9 border border-neutral-300 bg-white px-3 text-xs uppercase disabled:opacity-50">Gửi Pancake</button>
                        <button onClick={() => syncOrder(order, "misa")} disabled={busyCode === `${order.code}-misa`} className="h-9 border border-neutral-300 bg-white px-3 text-xs uppercase disabled:opacity-50">Gửi MISA</button>
                      </div>
                      <div className="border-t border-neutral-200 pt-2 text-xs text-neutral-500">
                        <div>Pancake: {order.externalSync?.pancake || "Chưa gửi"}</div>
                        {order.pancakeStatus && <div>Trạng thái Pancake: <strong>{pancakeStatusLabels[order.pancakeStatus]}</strong></div>}
                        <div>MISA: {order.externalSync?.misa || "Chưa gửi"}</div>
                        <div>VC: {order.externalSync?.shipping || "Chưa cập nhật"}</div>
                      </div>
                    </div>
                  </section>
                </div>
              )}
            </article>
          );
        })}
        {!sortedOrders.length && (
          <div className="border border-neutral-200 py-10 text-center text-neutral-500">Không có đơn phù hợp.</div>
        )}
      </section>
    </main>
  );
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function canCancelOrder(order: ShopOrder) {
  if (order.status === "cancelled") return false;
  const hasTrackingCode = Boolean(String(order.trackingCode || "").trim());
  if (["driver_assigned", "shipping", "delivered", "delivery_failed", "returning", "returned", "cancelled"].includes(order.shippingStatus || "")) return false;
  if (order.shippingStatus === "ready_to_ship" && hasTrackingCode) return false;
  if (["shipping", "completed", "returned", "cancelled"].includes(order.pancakeStatus || "")) return false;
  return true;
}

function Metric({ active = false, label, value, onClick }: { active?: boolean; label: string; value: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`min-h-24 border p-4 text-left transition ${active ? "border-black bg-black text-white" : "border-neutral-200 bg-white hover:border-black"}`}>
      <p className={`text-xs uppercase ${active ? "text-white/70" : "text-neutral-500"}`}>{label}</p>
      <strong className="mt-2 block text-3xl font-medium">{value}</strong>
    </button>
  );
}

function getOrderStage(order: ShopOrder): OrderStage {
  const shippingStatus = order.shippingStatus || "not_created";
  const paymentMethod = String(order.paymentMethod || "cod").trim().toLowerCase();
  const hasTrackingCode = Boolean(String(order.trackingCode || "").trim());
  const isReadyForShipment = order.status === "paid" || (order.status === "pending" && paymentMethod === "cod");

  if (order.status === "cancelled" || shippingStatus === "cancelled" || order.pancakeStatus === "cancelled") return "cancelled";
  if (order.status === "pending" && paymentMethod !== "cod") return "payment_pending";
  if (order.pancakeStatus === "returned") return "returning";
  if (order.pancakeStatus === "completed") return "delivered";
  if (order.pancakeStatus === "shipping") return "shipping";
  if (!hasTrackingCode) return isReadyForShipment ? "paid" : "new";
  if (shippingStatus === "returning" || shippingStatus === "returned") return "returning";
  if (shippingStatus === "delivery_failed") return "delivery_failed";
  if (shippingStatus === "delivered") return "delivered";
  if (shippingStatus === "shipping" || shippingStatus === "driver_assigned" || shippingStatus === "ready_to_ship" || hasTrackingCode) return "shipping";
  if (isReadyForShipment) return "paid";
  return "new";
}

function orderStageLabel(stage: OrderStage) {
  return orderStages.find((item) => item.value === stage)?.label || "Đơn mới đặt";
}

function shippingLabelForOrder(order: ShopOrder) {
  const status = order.shippingStatus || "not_created";
  const hasTrackingCode = Boolean(String(order.trackingCode || "").trim());
  if (status === "ready_to_ship" && !hasTrackingCode) return "Chưa có mã vận đơn, chờ giao hàng";
  return shippingLabels[status];
}

function orderSummary(order: ShopOrder) {
  return order.items
    .slice(0, 2)
    .map((item) => `${item.quantity}x ${item.name} ${item.color || ""} ${item.size || ""}`.trim())
    .join(" · ") + (order.items.length > 2 ? " · ..." : "");
}

function orderStageNote(order: ShopOrder) {
  const stage = getOrderStage(order);
  if (stage === "cancelled") return "Khách hủy khi đơn chưa giao cho đơn vị vận chuyển.";
  if (stage === "returning") return "Đơn đã giao đi nhưng đang hoàn về shop.";
  if (stage === "delivery_failed") return "Đơn vị vận chuyển báo giao không thành công.";
  if (stage === "shipping") return "Đơn đã có mã vận đơn và đang được vận chuyển.";
  if (stage === "payment_pending") return "Khách chưa hoàn tất thanh toán online.";
  if (stage === "paid") return "Đơn đã nhận tiền, đang chờ in và giao hàng.";
  return "Đơn vừa được tạo, chờ shop xử lý.";
}

function IntegrationBox({
  title,
  enabled,
  endpoint,
  inventoryEndpoint,
  token,
  endpointPlaceholder,
  onChange
}: {
  title: string;
  enabled: boolean;
  endpoint: string;
  inventoryEndpoint: string;
  token: string;
  endpointPlaceholder: string;
  onChange: (patch: { enabled?: boolean; endpoint?: string; inventoryEndpoint?: string; token?: string }) => void;
}) {
  return (
    <fieldset className="border border-neutral-200 p-4">
      <legend className="px-2 text-sm font-semibold uppercase">{title}</legend>
      <label className="mt-2 block text-sm"><input type="checkbox" checked={enabled} onChange={(event) => onChange({ enabled: event.target.checked })} className="mr-2" />Bật kết nối</label>
      <input value={endpoint} onChange={(event) => onChange({ endpoint: event.target.value })} placeholder={endpointPlaceholder} className="mt-3 h-10 w-full border px-3 text-sm" />
      <input value={inventoryEndpoint} onChange={(event) => onChange({ inventoryEndpoint: event.target.value })} placeholder="Endpoint tồn kho POS/MISA" className="mt-2 h-10 w-full border px-3 text-sm" />
      <input value={token} onChange={(event) => onChange({ token: event.target.value })} placeholder="API token / Bearer token" className="mt-2 h-10 w-full border px-3 text-sm" />
    </fieldset>
  );
}

function PaymentMerchantBox({
  title,
  enabled,
  fields,
  onEnabled,
  onField
}: {
  title: string;
  enabled: boolean;
  fields: Array<{ label: string; value: string; keyName: string; placeholder: string }>;
  onEnabled: (enabled: boolean) => void;
  onField: (key: string, value: string) => void;
}) {
  return (
    <fieldset className="border border-neutral-200 p-4">
      <legend className="px-2 text-sm font-semibold uppercase">{title}</legend>
      <label className="mt-2 block text-sm">
        <input type="checkbox" checked={enabled} onChange={(event) => onEnabled(event.target.checked)} className="mr-2" />
        Bật cổng thanh toán
      </label>
      <div className="mt-3 grid gap-2">
        {fields.map((field) => (
          <label key={field.keyName} className="text-xs uppercase text-neutral-500">
            {field.label}
            <input
              value={field.value}
              onChange={(event) => onField(field.keyName, event.target.value)}
              placeholder={field.placeholder}
              className="mt-1 h-10 w-full border px-3 text-sm normal-case text-black"
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function paymentLabel(status: OrderStatus, paymentMethod?: ShopOrder["paymentMethod"]) {
  if (status === "paid") return "Đã thanh toán";
  if (status === "pending" && paymentMethod === "cod") return "COD - chờ giao hàng";
  if (status === "pending") return "Chờ thanh toán";
  if (status === "failed") return "Thất bại";
  return "Đã hủy";
}

function paymentStatusClass(status: OrderStatus, paymentMethod?: ShopOrder["paymentMethod"]) {
  if (status === "paid") return "border-emerald-600 bg-emerald-50 text-emerald-700";
  if (status === "pending" && paymentMethod === "cod") return "border-emerald-600 bg-emerald-50 text-emerald-700";
  if (status === "pending") return "border-amber-500 bg-amber-50 text-amber-700";
  if (status === "failed") return "border-red-500 bg-red-50 text-red-700";
  return "border-neutral-400 bg-neutral-100 text-neutral-700";
}

function refundStatusLabel(status: ShopOrder["refundStatus"]) {
  if (status === "succeeded") return "Đã hoàn tiền";
  if (status === "pending") return "Đang xử lý hoàn tiền";
  if (status === "failed") return "Hoàn tiền lỗi";
  if (status === "not_required") return "Không cần hoàn";
  return "Chưa phát sinh";
}

function shippingStatusClass(status: ShippingStatus) {
  if (status === "delivered") return "border-emerald-600 bg-emerald-50 text-emerald-700";
  if (["finding_driver", "driver_assigned", "shipping", "ready_to_ship"].includes(status)) return "border-blue-500 bg-blue-50 text-blue-700";
  if (status === "returning" || status === "returned") return "border-orange-500 bg-orange-50 text-orange-700";
  if (status === "delivery_failed" || status === "cancelled") return "border-red-500 bg-red-50 text-red-700";
  return "border-neutral-400 bg-neutral-100 text-neutral-700";
}

function orderStageClass(stage: OrderStage) {
  if (stage === "delivered" || stage === "paid") return "border-emerald-600 bg-emerald-50 text-emerald-700";
  if (stage === "shipping") return "border-blue-500 bg-blue-50 text-blue-700";
  if (stage === "payment_pending" || stage === "returning") return "border-orange-500 bg-orange-50 text-orange-700";
  if (stage === "delivery_failed" || stage === "cancelled") return "border-red-500 bg-red-50 text-red-700";
  return "border-neutral-400 bg-neutral-100 text-neutral-700";
}
