import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { createJsonStoreBackup, getStoreHealthReport } from "@/lib/data-store";
import { readOrders } from "@/lib/orders";

export async function GET() {
  try {
    const [health, orders] = await Promise.all([getStoreHealthReport(), readOrders()]);
    return NextResponse.json({
      ...health,
      orders: {
        count: orders.length,
        lastCreatedAt: orders[0]?.createdAt || "",
        lastUpdatedAt: orders
          .map((order) => order.updatedAt || order.createdAt)
          .filter(Boolean)
          .sort((left, right) => String(right).localeCompare(String(left)))[0] || ""
      }
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST() {
  try {
    const orders = await readOrders();
    const backup = await createJsonStoreBackup("orders.json", orders, "manual-admin-orders-backup");
    return NextResponse.json({
      ok: true,
      backup,
      orders: { count: orders.length }
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  } catch (error) {
    return jsonError(error);
  }
}
