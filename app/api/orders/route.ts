import { NextResponse } from "next/server";
import { readOrders, updateOrder } from "@/lib/orders";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import { readIntegrationConfig } from "@/lib/integrations";
import { reconcileZaloPayPayment, reconcileZaloPayRefund } from "@/lib/payment-confirmation";
import { shortOrderCode } from "@/lib/order-code";

export async function GET(request: Request) {
  let orders = await readOrders();
  const invalidUnpaidRefunds = orders.filter((order) => order.status === "cancelled"
    && order.paymentMethod === "zalopay"
    && !order.transactionId
    && order.refundStatus !== "not_required");
  if (invalidUnpaidRefunds.length) {
    await Promise.all(invalidUnpaidRefunds.map((order) => updateOrder(order.code, {
      refundStatus: "not_required",
      refundProvider: undefined,
      refundId: undefined,
      refundTransactionId: undefined,
      refundAmount: undefined,
      refundMessage: ""
    })));
    orders = await readOrders();
  }
  const url = new URL(request.url);
  const codes = (url.searchParams.get("codes") || "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean)
    .slice(0, 20);

  if (codes.length) {
    const allowed = new Set(codes);
    const requested = orders.filter((order) => allowed.has(order.code));
    const integrations = await readIntegrationConfig();
    await Promise.allSettled(requested.map(async (order) => {
      let current = order;
      if (current.status === "pending" && current.paymentMethod === "zalopay") {
        current = await reconcileZaloPayPayment(current, integrations.payment);
      }
      if (["pending", "failed"].includes(current.refundStatus || "") && current.paymentMethod === "zalopay" && (current.refundId || current.transactionId)) {
        await reconcileZaloPayRefund(current, integrations.payment);
      }
    }));
    const paymentRefreshed = await readOrders();
    const paidRequested = paymentRefreshed.filter((order) => allowed.has(order.code)
      && order.status === "paid"
      && !["delivered", "returned", "cancelled"].includes(order.shippingStatus || ""));
    const sync = new OrderSyncService();
    await Promise.allSettled(paidRequested.map((order) => sync.create(order)));
    const refreshedOrders = await readOrders();
    return NextResponse.json({
      orders: refreshedOrders
        .filter((order) => allowed.has(order.code))
        .map((order) => ({
          code: order.code,
          createdAt: order.createdAt,
          status: order.status,
          paymentMethod: order.paymentMethod,
          paymentProvider: order.paymentProvider,
          transactionId: order.transactionId,
          refundStatus: order.refundStatus,
          refundMessage: order.refundMessage,
          refundAmount: order.refundAmount,
          refundedAt: order.refundedAt,
          shippingCarrier: order.shippingCarrier,
          trackingCode: order.trackingCode,
          shippingStatus: order.shippingStatus,
          shippingMessage: order.shippingMessage,
          deliveryType: order.deliveryType,
          deliveryProvider: order.deliveryProvider,
          deliveryOrderId: order.deliveryOrderId,
          deliveryDriver: order.deliveryDriver,
          deliveryTrackingUrl: order.deliveryTrackingUrl,
          deliveryFeeActual: order.deliveryFeeActual,
          pancakeStatus: order.pancakeStatus,
          updatedAt: order.updatedAt
        }))
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  }

  const unpaidOnlineOrdersOnPos = orders
    .filter((order) => order.status === "pending"
      && String(order.paymentMethod || "").trim().toLowerCase() !== "cod"
      && Boolean(order.pancakeOrderId)
      && order.pancakeStatus !== "cancelled"
      && !["shipping", "delivered", "delivery_failed", "returning", "returned", "cancelled"].includes(order.shippingStatus || ""))
    .slice(0, 10);
  const legacyLinkedOrders = orders
    .filter((order) => !unpaidOnlineOrdersOnPos.some((unpaid) => unpaid.code === order.code)
      && shortOrderCode(order.code) !== order.code
      && Boolean(order.pancakeOrderId || order.pancakeStatus)
      && order.posOrderCode !== shortOrderCode(order.code))
    .slice(0, 10);
  const paidOrdersNeedingPos = orders
    .filter((order) => (order.status === "paid" || (order.status === "pending" && String(order.paymentMethod || "").trim().toLowerCase() === "cod")) && !order.pancakeOrderId && !order.pancakeStatus)
    .slice(0, 20);
  const standardOrdersNeedingSpx = orders
    .filter((order) => order.deliveryType !== "express"
      && !unpaidOnlineOrdersOnPos.some((unpaid) => unpaid.code === order.code)
      && !legacyLinkedOrders.some((legacy) => legacy.code === order.code)
      && Boolean(order.pancakeOrderId || order.pancakeStatus)
      && !/spx|shopee\s*x?press/i.test(order.shippingCarrier || "")
      && !["shipping", "delivered", "delivery_failed", "returning", "returned", "cancelled"].includes(order.shippingStatus || ""))
    .slice(0, 20);
  if (unpaidOnlineOrdersOnPos.length || legacyLinkedOrders.length || paidOrdersNeedingPos.length || standardOrdersNeedingSpx.length) {
    const sync = new OrderSyncService();
    await Promise.allSettled([
      ...unpaidOnlineOrdersOnPos.map((order) => sync.removeUnpaidFromPos(order)),
      ...legacyLinkedOrders.map((order) => sync.reconcileExisting(order)),
      ...paidOrdersNeedingPos.map((order) => sync.create(order)),
      ...standardOrdersNeedingSpx.map((order) => sync.reconcileExisting(order))
    ]);
    return NextResponse.json({ orders: await readOrders() }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }

  return NextResponse.json({ orders }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
