import { updateOrder } from "@/lib/orders";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import type { ShopOrder } from "@/lib/types";

export class POSSyncService {
  constructor(
    private readonly orderSync = new OrderSyncService(),
    private readonly inventory = new InventoryService()
  ) {}

  async confirmOrder(order: ShopOrder) {
    const synced = await this.orderSync.create(order);
    if (this.inventory.configured() && !synced.inventoryReservationApplied) {
      await this.inventory.reserve(synced.items, "decrease");
      return await updateOrder(synced.code, { inventoryReservationApplied: true }) || synced;
    }
    return synced;
  }
}
