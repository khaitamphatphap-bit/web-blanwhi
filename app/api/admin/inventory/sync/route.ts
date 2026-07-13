import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { integrationHeaders, readIntegrationConfig } from "@/lib/integrations";
import { buildProductInventory, readSiteContent, writeSiteContent } from "@/lib/site-content";

type SyncRequest = {
  target?: "pos" | "misa";
  direction?: "pull" | "push";
};

type RemoteInventoryItem = {
  sku?: unknown;
  code?: unknown;
  productCode?: unknown;
  quantity?: unknown;
  stock?: unknown;
  onHand?: unknown;
  available?: unknown;
};

function remoteItems(payload: unknown): RemoteInventoryItem[] {
  if (Array.isArray(payload)) return payload as RemoteInventoryItem[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["items", "products", "inventory", "data"]) {
    if (Array.isArray(record[key])) return record[key] as RemoteInventoryItem[];
    if (record[key] && typeof record[key] === "object") {
      const nested = remoteItems(record[key]);
      if (nested.length) return nested;
    }
  }
  return [];
}

function remoteSku(item: RemoteInventoryItem) {
  return String(item.sku ?? item.code ?? item.productCode ?? "").trim().toUpperCase();
}

function remoteQuantity(item: RemoteInventoryItem) {
  const value = Number(item.quantity ?? item.stock ?? item.onHand ?? item.available ?? 0);
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as SyncRequest;
    if (!body.target || !body.direction) {
      return NextResponse.json({ error: "Thiếu hệ thống hoặc chiều đồng bộ tồn kho." }, { status: 400 });
    }

    const integrations = await readIntegrationConfig();
    const connector = body.target === "pos" ? integrations.pancake : integrations.misa;
    const targetLabel = body.target === "pos" ? "POS" : "MISA";
    if (!connector.enabled || !connector.inventoryEndpoint) {
      return NextResponse.json({ error: `Chưa bật hoặc chưa nhập endpoint tồn kho ${targetLabel} ở trang Đơn hàng.` }, { status: 400 });
    }

    const content = await readSiteContent();
    const items = content.products.flatMap((product) => buildProductInventory(product).map((item) => ({
      productId: product.id,
      productName: product.name,
      classificationName: product.classifications?.find((classification) => classification.id === item.classificationId)?.name || "",
      colorName: item.color
        ? product.classifications?.find((classification) => classification.id === item.classificationId)?.colorNames?.[item.color]
          || product.colorNames?.[item.color]
          || item.color
        : "",
      ...item
    })));

    if (body.direction === "push") {
      const response = await fetch(connector.inventoryEndpoint, {
        method: "POST",
        headers: integrationHeaders(connector.token),
        body: JSON.stringify({ source: "BLANWHI", action: "inventory.update", items })
      });
      if (!response.ok) throw new Error(`${targetLabel} trả lỗi ${response.status} khi nhận tồn kho.`);
      return NextResponse.json({ message: `Đã gửi ${items.length} dòng tồn kho sang ${targetLabel}.`, sent: items.length });
    }

    const response = await fetch(connector.inventoryEndpoint, {
      method: "GET",
      headers: integrationHeaders(connector.token),
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`${targetLabel} trả lỗi ${response.status} khi lấy tồn kho.`);
    const received = remoteItems(await response.json());
    if (!received.length) throw new Error(`${targetLabel} chưa trả về danh sách tồn kho hợp lệ.`);

    const quantityBySku = new Map<string, number>(
      received
        .map((item): [string, number] => [remoteSku(item), remoteQuantity(item)])
        .filter(([sku]) => Boolean(sku))
    );
    let updated = 0;
    const nextContent = {
      ...content,
      products: content.products.map((product) => ({
        ...product,
        inventory: buildProductInventory(product).map((item) => {
          const quantity = quantityBySku.get(item.sku.trim().toUpperCase());
          if (quantity === undefined) return item;
          updated += 1;
          return { ...item, quantity };
        })
      }))
    };
    const saved = updated ? await writeSiteContent(nextContent) : nextContent;
    return NextResponse.json({ content: saved, message: `Đã lấy tồn kho ${targetLabel}: cập nhật ${updated}/${received.length} dòng khớp SKU.`, updated });
  } catch (error) {
    return jsonError(error);
  }
}
