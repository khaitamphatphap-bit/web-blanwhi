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
