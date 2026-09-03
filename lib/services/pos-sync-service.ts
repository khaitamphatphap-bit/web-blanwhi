import { updateOrder } from "@/lib/orders";
import { canCreatePancakeOrder } from "@/lib/order-readiness";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import type { ShopOrder } from "@/lib/types";

export class POSSyncService {
  constructor(
    private readonly orderSync = new OrderSyncService(),
    private readonly inventory = new InventoryService()
  ) {}

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
    const reserved = await this.inventory.reserveOrder(order);
    return this.orderSync.create(reserved);
  }
}
