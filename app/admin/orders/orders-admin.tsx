"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { IntegrationConfig, ShippingProvider } from "@/lib/integrations";
import { money } from "@/lib/pricing";
import type { OrderStatus, ShippingStatus, ShopOrder } from "@/lib/types";

type OrderStage =
  | "new"
  | "handed_to_carrier"
  | "shipping"
  | "delivered"
  | "payment_pending"
  | "paid"
  | "delivery_failed"
  | "returning"
  | "cancelled";

const orderStages: Array<{ value: OrderStage; label: string }> = [
  { value: "new", label: "Đơn mới đặt" },
  { value: "handed_to_carrier", label: "Đã giao cho ĐVVC" },
  { value: "shipping", label: "Đang giao hàng" },
  { value: "delivered", label: "Đã giao cho khách" },
  { value: "payment_pending", label: "Chờ thanh toán" },
  { value: "paid", label: "Đã thanh toán" },
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
    value: "viettelpost",
    label: "ViettelPost",
    endpoint: "https://partner.viettelpost.vn/v2/order/getOrderStatusByOrderNumber"
  },
  {
    value: "ghtk",
    label: "Giao Hàng Tiết Kiệm",
    endpoint: "https://services.giaohangtietkiem.vn/services/shipment/v2"
  },
  {
    value: "shopee_express",
    label: "Shopee Express",
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
  ready_to_ship: "Đã giao cho ĐVVC",
  shipping: "Đang giao hàng",
  delivered: "Đã giao cho khách",
  delivery_failed: "Giao hàng thất bại",
  returning: "Đang hoàn về",
  returned: "Đang hoàn về",
  cancelled: "Đơn hủy",
  unknown: "Không rõ"
};

const stageOrder = orderStages.reduce<Record<OrderStage, number>>((map, stage, index) => {
  map[stage.value] = index;
  return map;
}, {} as Record<OrderStage, number>);

export function OrdersAdmin({
  initialOrders,
  initialIntegrations
}: {
  initialOrders: ShopOrder[];
  initialIntegrations: IntegrationConfig;
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [message, setMessage] = useState("");
  const [busyCode, setBusyCode] = useState("");
  const [autoSyncText, setAutoSyncText] = useState("Tự động cập nhật đang bật");
  const [stageFilter, setStageFilter] = useState<OrderStage | "all">("all");
  const [expandedOrderCode, setExpandedOrderCode] = useState("");
  const orderListRef = useRef<HTMLElement | null>(null);
  const filteredOrders = useMemo(() => stageFilter === "all" ? orders : orders.filter((order) => getOrderStage(order) === stageFilter), [orders, stageFilter]);
  const sortedOrders = useMemo(() => [...filteredOrders].sort((left, right) => {
    const stageDiff = stageOrder[getOrderStage(left)] - stageOrder[getOrderStage(right)];
    if (stageDiff) return stageDiff;
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  }), [filteredOrders]);
  const totals = useMemo(() => ({
    revenue: orders.filter((order) => order.status === "paid").reduce((sum, order) => sum + order.total, 0)
  }), [orders]);

  async function refreshOrders() {
    const response = await fetch("/api/orders", { cache: "no-store" });
    const data = await response.json();
    setOrders(data.orders || []);
  }

  function selectStage(stage: OrderStage | "all") {
    setStageFilter(stage);
    setExpandedOrderCode("");
    window.requestAnimationFrame(() => {
      orderListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  async function updateShipping(order: ShopOrder) {
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

  async function updateAllShipping(silent = false) {
    if (!silent) {
      setBusyCode("all-shipping");
      setMessage("");
    }
    try {
      const response = await fetch("/api/admin/orders/shipping-sync", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không cập nhật được vận chuyển.");
      await refreshOrders();
      const text = `Đã kiểm tra ${data.checked || 0} đơn: ${data.success || 0} cập nhật thành công, ${data.failed || 0} lỗi.`;
      setAutoSyncText(`Tự động cập nhật: ${text}`);
      if (!silent) setMessage(text);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Không cập nhật được vận chuyển.";
      setAutoSyncText(`Tự động cập nhật: ${text}`);
      if (!silent) setMessage(text);
    } finally {
      if (!silent) setBusyCode("");
    }
  }

  useEffect(() => {
    const refreshTimer = window.setInterval(() => {
      refreshOrders().catch(() => undefined);
    }, 10000);
    const shippingTimer = window.setInterval(() => {
      if (!integrations.shipping.enabled) return;
      updateAllShipping(true).catch(() => undefined);
    }, 60000);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(shippingTimer);
    };
  }, [integrations.shipping.enabled]);

  return (
    <main className="mx-auto min-h-screen max-w-7xl bg-white px-6 py-10 md:my-12 md:px-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <Link href="/preview.html" className="text-xs uppercase text-neutral-500">BLANWHI</Link>
          <h1 className="mt-3 text-4xl font-medium">Quản trị đơn hàng</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/site" className="h-10 border border-neutral-300 px-4 pt-2 text-xs uppercase">Admin website</Link>
          <button onClick={() => updateAllShipping()} disabled={busyCode === "all-shipping"} className="h-10 border border-black bg-black px-4 text-xs uppercase text-white disabled:opacity-50">Cập nhật tất cả VC</button>
          <button onClick={refreshOrders} className="h-10 border border-black px-4 text-xs uppercase">Tải lại đơn</button>
        </div>
      </header>

      {message && <p className="mt-4 border border-neutral-200 bg-neutral-50 p-3 text-sm">{message}</p>}
      <p className="mt-4 border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{autoSyncText}. Admin tự tải lại mỗi 10 giây, tự hỏi API vận chuyển mỗi 60 giây khi đã bật kết nối.</p>

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
        {stageFilter !== "all" && (
          <button onClick={() => selectStage("all")} className="h-9 border border-black px-4 text-xs uppercase">Tất cả đơn</button>
        )}
      </div>
      <section className="mt-3 border border-neutral-200 p-4">
        <p className="text-xs uppercase text-neutral-500">Doanh thu đã thanh toán</p>
        <strong className="mt-1 block text-3xl font-medium">{money(totals.revenue)}</strong>
      </section>

      <form onSubmit={saveIntegrations} className="mt-8 grid gap-4 border border-neutral-200 p-4 lg:grid-cols-3">
        <IntegrationBox
          title="Pancake POS"
          enabled={integrations.pancake.enabled}
          endpoint={integrations.pancake.endpoint}
          token={integrations.pancake.token}
          endpointPlaceholder="https://.../pancake/orders"
          onChange={(patch) => setIntegrations({ ...integrations, pancake: { ...integrations.pancake, ...patch } })}
        />
        <IntegrationBox
          title="MISA eShop"
          enabled={integrations.misa.enabled}
          endpoint={integrations.misa.endpoint}
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
        <div className="lg:col-span-3">
          <button className="h-10 bg-black px-5 text-xs uppercase text-white">Lưu cấu hình tích hợp</button>
          <p className="mt-3 text-xs leading-5 text-neutral-500">
            Webhook nhận trạng thái: /api/webhooks/shipping · /api/webhooks/misa · /api/webhooks/pancake
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
                  <Link href={`/payment-result?orderCode=${order.code}`} className="border-b border-black text-sm font-semibold">{order.code}</Link>
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
                  <span className={`mt-2 inline-flex border px-2 py-1 text-xs uppercase ${paymentStatusClass(order.status)}`}>{paymentLabel(order.status)}</span>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <button onClick={() => setExpandedOrderCode(isOpen ? "" : order.code)} className="h-9 border border-black px-3 text-xs uppercase">{isOpen ? "Đóng" : "Chi tiết"}</button>
                  <button onClick={() => updateShipping(order)} disabled={busyCode === `${order.code}-shipping`} className="h-9 border border-neutral-300 px-3 text-xs uppercase disabled:opacity-50">Cập nhật VC</button>
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
                      <p><b>Tạm tính:</b> {money(order.subtotal)}</p>
                      <p><b>Giảm giá:</b> -{money(order.discount)}</p>
                      <p><b>Ship:</b> {order.shippingFeeLabel || money(order.shipping)}</p>
                      <p><b>Tổng:</b> {money(order.total)}</p>
                      <p><b>Mã giao dịch:</b> {order.transactionId || "Chưa có"}</p>
                      <p><b>Vận chuyển:</b> {order.shippingCarrier || "Chưa chọn"} · {order.shippingMethod || "Giao nhanh"}</p>
                      <p><b>Mã vận đơn:</b> {order.trackingCode || "Chưa có"}</p>
                      <span className={`inline-flex border px-2 py-1 text-xs uppercase ${shippingStatusClass(order.shippingStatus || "not_created")}`}>
                        {shippingLabels[order.shippingStatus || "not_created"]}
                      </span>
                      {order.shippingMessage && <p className="text-neutral-600">{order.shippingMessage}</p>}
                      <div className="grid gap-2 pt-2 sm:grid-cols-2">
                        <button onClick={() => syncOrder(order, "pancake")} disabled={busyCode === `${order.code}-pancake`} className="h-9 border border-neutral-300 bg-white px-3 text-xs uppercase disabled:opacity-50">Gửi Pancake</button>
                        <button onClick={() => syncOrder(order, "misa")} disabled={busyCode === `${order.code}-misa`} className="h-9 border border-neutral-300 bg-white px-3 text-xs uppercase disabled:opacity-50">Gửi MISA</button>
                      </div>
                      <div className="border-t border-neutral-200 pt-2 text-xs text-neutral-500">
                        <div>Pancake: {order.externalSync?.pancake || "Chưa gửi"}</div>
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
          <div className="border border-neutral-200 py-10 text-center text-neutral-500">Không có đơn trong trạng thái này.</div>
        )}
      </section>
    </main>
  );
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
  const hasCarrier = Boolean(order.trackingCode || order.shippingCarrier || order.externalSync?.shipping);

  if (shippingStatus === "returning" || shippingStatus === "returned") return "returning";
  if (shippingStatus === "delivery_failed") return "delivery_failed";
  if (shippingStatus === "delivered") return "delivered";
  if (shippingStatus === "shipping") return "shipping";
  if (shippingStatus === "ready_to_ship" || (hasCarrier && shippingStatus !== "cancelled")) return "handed_to_carrier";
  if (order.status === "cancelled" || shippingStatus === "cancelled") return "cancelled";
  if (order.status === "pending" && order.paymentMethod !== "cod") return "payment_pending";
  if (order.status === "paid") return "paid";
  return "new";
}

function orderStageLabel(stage: OrderStage) {
  return orderStages.find((item) => item.value === stage)?.label || "Đơn mới đặt";
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
  if (stage === "handed_to_carrier") return "Shop đã bàn giao đơn cho đơn vị vận chuyển.";
  if (stage === "payment_pending") return "Khách chưa hoàn tất thanh toán online.";
  if (stage === "paid") return "Đơn đã nhận tiền, chưa giao cho vận chuyển.";
  return "Đơn vừa được tạo, chờ shop xử lý.";
}

function IntegrationBox({
  title,
  enabled,
  endpoint,
  token,
  endpointPlaceholder,
  onChange
}: {
  title: string;
  enabled: boolean;
  endpoint: string;
  token: string;
  endpointPlaceholder: string;
  onChange: (patch: { enabled?: boolean; endpoint?: string; token?: string }) => void;
}) {
  return (
    <fieldset className="border border-neutral-200 p-4">
      <legend className="px-2 text-sm font-semibold uppercase">{title}</legend>
      <label className="mt-2 block text-sm"><input type="checkbox" checked={enabled} onChange={(event) => onChange({ enabled: event.target.checked })} className="mr-2" />Bật kết nối</label>
      <input value={endpoint} onChange={(event) => onChange({ endpoint: event.target.value })} placeholder={endpointPlaceholder} className="mt-3 h-10 w-full border px-3 text-sm" />
      <input value={token} onChange={(event) => onChange({ token: event.target.value })} placeholder="API token / Bearer token" className="mt-2 h-10 w-full border px-3 text-sm" />
    </fieldset>
  );
}

function paymentLabel(status: OrderStatus) {
  if (status === "paid") return "Đã thanh toán";
  if (status === "pending") return "Chờ thanh toán";
  if (status === "failed") return "Thất bại";
  return "Đã hủy";
}

function paymentStatusClass(status: OrderStatus) {
  if (status === "paid") return "border-emerald-600 bg-emerald-50 text-emerald-700";
  if (status === "pending") return "border-amber-500 bg-amber-50 text-amber-700";
  if (status === "failed") return "border-red-500 bg-red-50 text-red-700";
  return "border-neutral-400 bg-neutral-100 text-neutral-700";
}

function shippingStatusClass(status: ShippingStatus) {
  if (status === "delivered") return "border-emerald-600 bg-emerald-50 text-emerald-700";
  if (status === "shipping" || status === "ready_to_ship") return "border-blue-500 bg-blue-50 text-blue-700";
  if (status === "returning" || status === "returned") return "border-orange-500 bg-orange-50 text-orange-700";
  if (status === "delivery_failed" || status === "cancelled") return "border-red-500 bg-red-50 text-red-700";
  return "border-neutral-400 bg-neutral-100 text-neutral-700";
}

function orderStageClass(stage: OrderStage) {
  if (stage === "delivered" || stage === "paid") return "border-emerald-600 bg-emerald-50 text-emerald-700";
  if (stage === "handed_to_carrier" || stage === "shipping") return "border-blue-500 bg-blue-50 text-blue-700";
  if (stage === "payment_pending" || stage === "returning") return "border-orange-500 bg-orange-50 text-orange-700";
  if (stage === "delivery_failed" || stage === "cancelled") return "border-red-500 bg-red-50 text-red-700";
  return "border-neutral-400 bg-neutral-100 text-neutral-700";
}
