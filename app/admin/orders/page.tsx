import { readIntegrationConfig } from "@/lib/integrations";
import { readOrders } from "@/lib/orders";
import { OrdersAdmin } from "./orders-admin";
import { readDeliveryConfig, deliveryConfigured } from "@/lib/delivery/config";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const [orders, integrations] = await Promise.all([readOrders(), readIntegrationConfig()]);
  const delivery = readDeliveryConfig();
  return <OrdersAdmin initialOrders={orders} initialIntegrations={integrations} deliveryConfig={{ provider: delivery.provider, configured: deliveryConfigured(delivery), senderReady: Boolean(delivery.sender.phone && delivery.sender.address && delivery.sender.latitude && delivery.sender.longitude) }} />;
}
