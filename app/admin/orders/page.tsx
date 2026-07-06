import { readIntegrationConfig } from "@/lib/integrations";
import { readOrders } from "@/lib/orders";
import { OrdersAdmin } from "./orders-admin";

export default async function AdminOrdersPage() {
  const [orders, integrations] = await Promise.all([readOrders(), readIntegrationConfig()]);
  return <OrdersAdmin initialOrders={orders} initialIntegrations={integrations} />;
}
