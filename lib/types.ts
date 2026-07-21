export type ColorOption = {
  name: string;
  value: string;
  tone: "light" | "dark" | "neutral" | "warm" | "cool";
};

export type Product = {
  id: string;
  name: string;
  type: "T-shirt" | "Hoodie" | "Pants" | "Jacket" | "Shirt" | "Shorts";
  price: number;
  image: string;
  videoFabric: string;
  videoColor: string;
  colors: ColorOption[];
  sizes: string[];
  stock: Record<string, number>;
  fit: string;
  material: string;
  featured?: boolean;
};

export type CartItem = {
  product: Product;
  color: ColorOption;
  size: string;
  quantity: number;
};

export type Combo = {
  id: string;
  title: string;
  description: string;
  productIds: string[];
  price: number;
  originalPrice: number;
};

export type Voucher = {
  id: string;
  title: string;
  description: string;
  discount: number;
  freeship?: boolean;
  unlocked: boolean;
  progress: string;
};

export type PaymentMethod = "cod" | "bank_transfer" | "vnpay" | "onepay" | "alepay" | "momo" | "zalopay";

export type OrderStatus = "pending" | "paid" | "failed" | "cancelled";
export type ShippingStatus =
  | "not_created"
  | "awaiting_creation"
  | "finding_driver"
  | "driver_assigned"
  | "ready_to_ship"
  | "shipping"
  | "delivered"
  | "delivery_failed"
  | "returning"
  | "returned"
  | "cancelled"
  | "unknown";

export type OrderCustomer = {
  name: string;
  phone: string;
  email?: string;
  address: string;
  house?: string;
  ward?: string;
  province?: string;
  provinceId?: string;
  district?: string;
  districtId?: string;
  wardId?: string;
  note?: string;
  latitude?: string;
  longitude?: string;
};

export type OrderItem = {
  productId: string;
  sku?: string;
  pancakeSku?: string;
  pancakeProductId?: string;
  pancakeVariationId?: string;
  inventoryKey?: string;
  name: string;
  color: string;
  size: string;
  quantity: number;
  unitPrice: number;
};

export type ShopOrder = {
  id: string;
  code: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentProvider: string;
  customer: OrderCustomer;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  shippingMethod?: string;
  shippingFeeLabel?: string;
  shippingCarrier?: string;
  trackingCode?: string;
  shippingStatus?: ShippingStatus;
  shippingMessage?: string;
  deliveryType?: "standard" | "express";
  deliveryProvider?: "ahamove" | "lalamove";
  deliveryOrderId?: string;
  deliveryQuotationId?: string;
  deliveryDriver?: { id?: string; name?: string; phone?: string; plateNumber?: string };
  deliveryTrackingUrl?: string;
  deliveryFeeEstimated?: number;
  deliveryFeeActual?: number;
  deliveryWeightGrams?: number;
  deliveryLengthCm?: number;
  deliveryWidthCm?: number;
  deliveryHeightCm?: number;
  total: number;
  transactionId?: string;
  providerOrderId?: string;
  providerMessage?: string;
  pancakeStatus?: "pending_confirmation" | "confirmed" | "packing" | "shipping" | "completed" | "cancelled" | "returned";
  externalSync?: {
    misa?: string;
    pancake?: string;
    shipping?: string;
    lastSyncedAt?: string;
  };
  inventoryReservationApplied?: boolean;
  inventoryReservationReleased?: boolean;
  createdAt: string;
  updatedAt: string;
};
