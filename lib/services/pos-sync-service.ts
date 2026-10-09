import { updateOrder } from "@/lib/orders";
import { canCreatePancakeOrder } from "@/lib/order-readiness";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import type { ShopOrder } from "@/lib/types";
import { pancakeConnectionForOrder } from "@/lib/pancake/connections";
import { PancakeService } from "@/lib/pancake/pancake-service";

export class POSSyncService {
  async confirmOrder(order: ShopOrder) {
    if (!canCreatePancakeOrder(order)) {
      return await updateOrder(order.code, {
        externalSync: {
          ...order.externalSync,
          pancake: "Chờ thanh toán - chưa gửi Pancake",
          lastSyncedAt: new Date().toISOString()
        }
      }) || order;
    }
    const reserved = await new InventoryService().reserveOrder(order);
    const orderSync = new OrderSyncService(new PancakeService(pancakeConnectionForOrder(reserved)));
    return orderSync.create(reserved);
  }
}
