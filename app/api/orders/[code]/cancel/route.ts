import { NextResponse } from "next/server";
import { findOrderByCode, updateOrder } from "@/lib/orders";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";

type Params = { params: Promise<{ code: string }> };

function phoneKey(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function canCancel(order: NonNullable<Awaited<ReturnType<typeof findOrderByCode>>>) {
  if (order.status === "cancelled" || order.status === "paid") return false;
  if (["ready_to_ship", "shipping", "delivered", "returning", "returned"].includes(order.shippingStatus || "")) return false;
  return !["confirmed", "packing", "shipping", "completed", "returned"].includes(order.pancakeStatus || "");
}

export async function POST(request: Request, { params }: Params) {
  const { code } = await params;
  const body = await request.json().catch(() => ({})) as { phone?: string; reason?: string };
  const order = await findOrderByCode(code);
  if (!order) return NextResponse.json({ error: "Không tìm thấy đơn hàng." }, { status: 404 });
  if (!phoneKey(body.phone) || phoneKey(body.phone) !== phoneKey(order.customer.phone)) {
    return NextResponse.json({ error: "Số điện thoại không khớp với đơn hàng." }, { status: 403 });
  }
  if (!canCancel(order)) {
    return NextResponse.json({ error: "Đơn đã được xác nhận hoặc bàn giao vận chuyển nên không thể hủy trực tuyến." }, { status: 409 });
  }

  if (order.inventoryReservationApplied && !order.inventoryReservationReleased) {
    await new InventoryService().reserve(order.items, "restore");
  }
  const cancelled = await updateOrder(code, {
    status: "cancelled",
    shippingStatus: "cancelled",
    shippingMessage: body.reason?.trim() || "Khách yêu cầu hủy đơn",
    inventoryReservationReleased: true
  });

  if (cancelled?.providerOrderId) {
    try {
      await new OrderSyncService().cancel(cancelled);
    } catch {
      // Đơn đã được hủy trên website; hàng đợi sẽ tiếp tục gửi yêu cầu sang POS.
    }
  }
  return NextResponse.json({ ok: true, order: cancelled });
}
