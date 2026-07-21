import { findOrderByCode, updateOrder, updateOrderStatus } from "@/lib/orders";
import { POSSyncService } from "@/lib/services/pos-sync-service";
import type { ShopOrder } from "@/lib/types";

type VerifiedPaymentPatch = Partial<Pick<ShopOrder, "transactionId" | "paymentProviderOrderId" | "paymentLinkId" | "providerMessage">>;

export async function confirmVerifiedPayment(orderCode: string, patch: VerifiedPaymentPatch = {}) {
  const existing = await findOrderByCode(orderCode);
  if (!existing) return null;
  if (existing.status === "cancelled") return existing;

  const statusUpdated = existing.status === "paid"
    ? existing
    : await updateOrderStatus(existing.code, "paid", {
        transactionId: patch.transactionId,
        providerMessage: patch.providerMessage
      });
  if (!statusUpdated) return null;
  const paid = await updateOrder(existing.code, patch) || statusUpdated;

  try {
    return await new POSSyncService().confirmOrder(paid);
  } catch (error) {
    const message = error instanceof Error ? error.message : "POS sync failed";
    return await updateOrder(paid.code, {
      externalSync: {
        ...paid.externalSync,
        pancake: `Payment confirmed; waiting to retry POS sync: ${message}`,
        lastSyncedAt: new Date().toISOString()
      }
    }) || paid;
  }
}
