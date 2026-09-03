import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { readJsonStore, readJsonStoreHistory } from "@/lib/data-store";
import { readOrders } from "@/lib/orders";
import { readPaymentOrphans } from "@/lib/payment-orphans";
import type { ShopOrder } from "@/lib/types";

type TraceHit = {
  source: string;
  matched: string[];
  summary: string;
  record: unknown;
};

const privateStores = [
  "deleted-orders.json",
  "pancake-logs.json",
  "pancake-queue.json",
  "pancake-links.json"
];

function normalize(input: string) {
  return input.trim().toLowerCase();
}

function queryTerms(request: Request) {
  const url = new URL(request.url);
  const raw = [
    url.searchParams.get("q") || "",
    url.searchParams.get("code") || "",
    url.searchParams.get("phone") || "",
    url.searchParams.get("amount") || ""
  ].join(" ");
  return raw
    .split(/[\s,;|]+/)
    .map(normalize)
    .filter((term) => term.length >= 3);
}

function textOf(value: unknown) {
  return normalize(JSON.stringify(value));
}

function matches(value: unknown, terms: string[]) {
  const text = textOf(value);
  return terms.filter((term) => text.includes(term));
}

function orderSummary(order: ShopOrder) {
  return `${order.code} · ${order.customer?.name || "Không tên"} · ${order.customer?.phone || "Không SĐT"} · ${order.total || 0}đ · ${order.status}`;
}

function pushHit(hits: TraceHit[], source: string, record: unknown, terms: string[], summary?: string) {
  const matched = matches(record, terms);
  if (!matched.length) return;
  hits.push({
    source,
    matched,
    summary: summary || matched.join(", "),
    record
  });
}

export async function GET(request: Request) {
  try {
    const terms = queryTerms(request);
    if (!terms.length) {
      return NextResponse.json({ error: "Nhập mã đơn, số điện thoại hoặc số tiền cần truy vết." }, { status: 400 });
    }

    const [orders, paymentOrphans, orderHistories, storeValues, storeHistories] = await Promise.all([
      readOrders(),
      readPaymentOrphans(),
      readJsonStoreHistory<ShopOrder[]>("orders.json", 250),
      Promise.all(privateStores.map(async (store) => [store, await readJsonStore<unknown>(store, [])] as const)),
      Promise.all(privateStores.map(async (store) => [store, await readJsonStoreHistory<unknown>(store, 250)] as const))
    ]);

    const hits: TraceHit[] = [];
    orders.forEach((order) => pushHit(hits, "orders.current", order, terms, orderSummary(order)));
    paymentOrphans.forEach((payment) => pushHit(hits, "payments.orphaned", payment, terms, `${payment.orderCode} · ${payment.provider} · ${payment.amount}đ · ${payment.reason}`));

    orderHistories.forEach((snapshot, snapshotIndex) => {
      snapshot.forEach((order) => {
        pushHit(hits, `orders.history.${snapshotIndex + 1}`, order, terms, orderSummary(order));
      });
    });

    storeValues.forEach(([store, value]) => {
      if (Array.isArray(value)) {
        value.forEach((record, index) => pushHit(hits, `${store}.current.${index + 1}`, record, terms));
      } else {
        pushHit(hits, `${store}.current`, value, terms);
      }
    });

    storeHistories.forEach(([store, snapshots]) => {
      snapshots.forEach((snapshot, snapshotIndex) => {
        if (Array.isArray(snapshot)) {
          snapshot.forEach((record, recordIndex) => pushHit(hits, `${store}.history.${snapshotIndex + 1}.${recordIndex + 1}`, record, terms));
        } else {
          pushHit(hits, `${store}.history.${snapshotIndex + 1}`, snapshot, terms);
        }
      });
    });

    return NextResponse.json({
      terms,
      count: hits.length,
      hits: hits.slice(0, 200)
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  } catch (error) {
    return jsonError(error);
  }
}
