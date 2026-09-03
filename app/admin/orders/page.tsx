import { readIntegrationConfig } from "@/lib/integrations";
import { readOrders } from "@/lib/orders";
import { readPaymentOrphans } from "@/lib/payment-orphans";
import { OrdersAdmin } from "./orders-admin";
import { readDeliveryConfig, deliveryConfigured } from "@/lib/delivery/config";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const [orders, integrations, paymentOrphans] = await Promise.all([readOrders(), readIntegrationConfig(), readPaymentOrphans()]);
  const delivery = readDeliveryConfig();
  return <OrdersAdmin initialOrders={orders} initialPaymentOrphans={paymentOrphans} initialIntegrations={integrations} deliveryConfig={{ provider: delivery.provider, configured: deliveryConfigured(delivery), senderReady: Boolean(delivery.sender.phone && delivery.sender.address && delivery.sender.latitude && delivery.sender.longitude) }} />;
}
