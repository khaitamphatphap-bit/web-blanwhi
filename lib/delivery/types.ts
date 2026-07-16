import type { OrderCustomer, OrderItem, ShopOrder, ShippingStatus } from "@/lib/types";

export type DeliveryProvider = "ahamove" | "lalamove";
export type DeliveryLocation = { name: string; phone: string; address: string; latitude?: string; longitude?: string };
export type DeliveryPackage = { cod: number; weightGrams: number; lengthCm: number; widthCm: number; heightCm: number; items: OrderItem[] };
export type DeliveryRequest = { referenceCode: string; sender: DeliveryLocation; recipient: DeliveryLocation; package: DeliveryPackage; note?: string; quotationId?: string };
export type DeliveryQuote = { provider: DeliveryProvider; fee: number; currency: string; quotationId?: string; expiresAt?: string; estimated: boolean; message?: string; raw?: unknown };
export type DeliveryResult = {
  provider: DeliveryProvider;
  providerName: string;
  orderId: string;
  trackingCode: string;
  status: ShippingStatus;
  fee: number;
  driver?: { id?: string; name?: string; phone?: string; plateNumber?: string };
  trackingUrl?: string;
  message?: string;
  raw?: unknown;
};

export interface DeliveryService {
  calculateShippingFee(request: DeliveryRequest): Promise<DeliveryQuote>;
  createDeliveryOrder(request: DeliveryRequest): Promise<DeliveryResult>;
  cancelDeliveryOrder(order: ShopOrder, reason?: string): Promise<DeliveryResult>;
  trackingDelivery(order: ShopOrder): Promise<DeliveryResult>;
}

export function recipientFromCustomer(customer: OrderCustomer): DeliveryLocation {
  return { name: customer.name, phone: customer.phone, address: customer.address, latitude: customer.latitude, longitude: customer.longitude };
}
