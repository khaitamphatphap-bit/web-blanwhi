import { NextResponse } from "next/server";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { PancakeLogger } from "@/lib/pancake/logger";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import { PancakeService } from "@/lib/pancake/pancake-service";
import { ProductLinkService } from "@/lib/pancake/product-link-service";
import { QueueHandler } from "@/lib/pancake/queue-handler";
import { buildProductInventory } from "@/lib/product-inventory";
import { findOrderByCode, updateOrder } from "@/lib/orders";
import { readSiteContent, seedPancakeProductLinks } from "@/lib/site-content";
import { hasBlobStore, hasDatabase, hasR2Store } from "@/lib/data-store";
import {
  connectionConfigured,
  connectionReadyForNewOrders,
  pancakeConnection,
  readPancakeRoutingState,
  setActivePancakeConnection,
  type PancakeConnectionId
} from "@/lib/pancake/connections";
import { productsForPancakeConnection } from "@/lib/pancake/connection-product-links";

async function dashboard() {
  const content = await readSiteContent();
  await seedPancakeProductLinks(content);
  const logs = await PancakeLogger.list();
  const queue = await QueueHandler.list();
  const routing = await readPancakeRoutingState();
  const activeConnection = pancakeConnection(routing.activeNewOrders);
  const pancake = new PancakeService(routing.activeNewOrders);
  const sourceSnapshot = await Promise.all([
    pancake.orderSources(),
    pancake.configuredOrderSource()
  ]).then(([orderSources, configuredOrderSource]) => ({ orderSources, configuredOrderSource, error: "" })).catch((error) => ({
    orderSources: [],
    configuredOrderSource: undefined,
    error: error instanceof Error ? error.message : "Không đọc được nguồn đơn Pancake."
  }));
  const productSets = Object.fromEntries(await Promise.all((["shop-1", "shop-2"] as PancakeConnectionId[]).map(async (id) => [
    id,
    await productsForPancakeConnection(content, id)
  ]))) as Record<PancakeConnectionId, Awaited<ReturnType<typeof productsForPancakeConnection>>>;
  const classificationNamesByProduct = new Map(content.products.map((product) => [
    product.id,
    new Map((product.classifications || []).map((item) => [item.id, item.name]))
  ]));
  const products = productSets[routing.activeNewOrders].map((product) => {
    const classificationNames = classificationNamesByProduct.get(product.id) || new Map<string, string>();
    return {
      id: product.id,
      name: product.name,
      rows: product.rows.map((item) => ({
        ...item,
        classificationName: item.classificationId ? classificationNames.get(item.classificationId) || item.classificationId : "",
        linked: item.linked,
        availableQuantity: InventoryService.available(item.publishQuantity, item.pancakeQuantity)
      }))
    };
  });
  const connectionDashboard = (["shop-1", "shop-2"] as PancakeConnectionId[]).map((id) => {
    const connection = pancakeConnection(id);
    const productRowCount = productSets[id].reduce((sum, product) => sum + product.rows.length, 0);
    const productLinkedCount = productSets[id].reduce((sum, product) => sum + product.rows.filter((row) => row.linked).length, 0);
    const sync = id === "shop-1"
      ? { ...routing.productSync[id], linkedCount: productLinkedCount, totalCount: productRowCount }
      : routing.productSync[id];
    return {
      id,
      name: connection.name,
      configured: connectionConfigured(connection),
      readyForNewOrders: id === "shop-1"
        ? connectionConfigured(connection)
        : connectionReadyForNewOrders(id, { ...routing, productSync: { ...routing.productSync, [id]: sync } }),
      receivesNewOrders: routing.activeNewOrders === id,
      keepsExistingOrders: true,
      configuration: {
        apiKey: Boolean(connection.apiKey),
        token: Boolean(connection.token),
        shopId: Boolean(connection.shopId),
        webhookSecret: Boolean(connection.webhookSecret),
        baseUrl: connection.baseUrl
      },
      productSync: sync,
      webhookUrl: id === "shop-1" ? "/api/webhooks/pancake" : "/api/webhooks/pancake/shop-2"
    };
  });
  return {
    connections: {
      activeNewOrders: routing.activeNewOrders,
      items: connectionDashboard
    },
    configuration: {
      apiKey: Boolean(activeConnection.apiKey),
      token: Boolean(activeConnection.token),
      shopId: Boolean(activeConnection.shopId),
      webhookSecret: Boolean(activeConnection.webhookSecret),
      baseUrl: activeConnection.baseUrl
    },
    orderSource: {
      targetName: activeConnection.orderSourceName || "facebook",
      targetId: activeConnection.orderSourceId || "",
      sources: sourceSnapshot.orderSources,
      matched: sourceSnapshot.configuredOrderSource,
      error: sourceSnapshot.error
    },
    storage: {
      database: hasDatabase(),
      r2: hasR2Store(),
      blob: hasBlobStore(),
      persistent: hasDatabase() || hasR2Store() || hasBlobStore()
    },
    webhookUrl: routing.activeNewOrders === "shop-1" ? "/api/webhooks/pancake" : "/api/webhooks/pancake/shop-2",
    products,
    logs: logs.slice(0, 100),
    queueCount: queue.length
  };
}

export async function GET() {
  return NextResponse.json(await dashboard(), { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      action?: string;
      orderCode?: string;
      productId?: string;
      rowKey?: string;
      variationId?: string;
      providerOrderId?: string;
      variation?: { id?: string; productId?: string; sku?: string; quantity?: number };
      connectionId?: PancakeConnectionId;
    };
    if (body.action === "set-active-connection" && body.connectionId) {
      await setActivePancakeConnection(body.connectionId);
      return NextResponse.json({ ok: true, dashboard: await dashboard() });
    }
    const selectedConnection = body.connectionId || (await readPancakeRoutingState()).activeNewOrders;
    const selectedPancake = new PancakeService(selectedConnection);
    if (body.action === "variations") {
      return NextResponse.json({ ok: true, result: await new ProductLinkService(selectedPancake).variations() });
    }
    if (body.action === "link-product") {
      return NextResponse.json({ ok: true, result: await new ProductLinkService(selectedPancake).update(body) });
    }
    if (body.action === "cancel-linked-order" && body.orderCode && body.providerOrderId) {
      const order = await findOrderByCode(body.orderCode);
      if (!order) return NextResponse.json({ error: "Không tìm thấy đơn hàng website." }, { status: 404 });
      if (order.status !== "cancelled") {
        return NextResponse.json({ error: "Chỉ được đối chiếu hủy đơn khách đã hủy trên website." }, { status: 409 });
      }
      const linked = await updateOrder(order.code, { pancakeOrderId: String(body.providerOrderId).trim() });
      if (!linked) return NextResponse.json({ error: "Không thể lưu ID đơn Pancake." }, { status: 500 });
      const result = await new OrderSyncService(new PancakeService(linked.pancakeConnectionId || "shop-1")).cancel(linked, false);
      return NextResponse.json({ ok: true, result });
    }
    let result: unknown;
    if (body.action === "test") result = await selectedPancake.testConnection();
    else if (body.action === "order-sources") result = {
      sources: await selectedPancake.orderSources(),
      matched: await selectedPancake.configuredOrderSource()
    };
    else if (body.action === "recover-links") result = await new ProductLinkService(selectedPancake).recoverLinks();
    else if (body.action === "sync-inventory") result = await new ProductLinkService(selectedPancake).recoverLinks();
    else if (body.action === "retry-order" && body.orderCode) {
      const order = await findOrderByCode(body.orderCode);
      if (!order) return NextResponse.json({ error: "Không tìm thấy đơn hàng website." }, { status: 404 });
      result = await new OrderSyncService(new PancakeService(order.pancakeConnectionId || "shop-1")).retry(body.orderCode);
    }
    else return NextResponse.json({ error: "Hành động Pancake không hợp lệ." }, { status: 400 });
    return NextResponse.json({ ok: true, result, dashboard: await dashboard() });
  } catch (error) {
    const normalized = ExceptionHandler.normalize(error);
    return NextResponse.json({ error: normalized.message, code: normalized.code }, { status: normalized.status });
  }
}
