import { CartItem, Voucher } from "./types";

export const money = (value: number) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value);

export function cartSubtotal(items: CartItem[]) {
  return items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
}

export function itemCount(items: CartItem[]) {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

export function getVouchers(items: CartItem[]): Voucher[] {
  const subtotal = cartSubtotal(items);
  const count = itemCount(items);
  const rules = [
    { id: "v500", title: "Từ 500k", description: "Giảm 5% cho đơn đạt 500k.", min: 500000, qty: 0, discount: 0.05 },
    { id: "v1m", title: "Từ 1 triệu", description: "Giảm 10% cho đơn đạt 1 triệu.", min: 1000000, qty: 0, discount: 0.1 },
    { id: "v2m", title: "Từ 2 triệu", description: "Freeship + giảm 15%.", min: 2000000, qty: 0, discount: 0.15, freeship: true },
    { id: "q2", title: "Mua 2 sản phẩm", description: "Giảm 5% khi giỏ có 2 món.", min: 0, qty: 2, discount: 0.05 },
    { id: "q3", title: "Mua 3 sản phẩm", description: "Giảm 10% khi giỏ có 3 món.", min: 0, qty: 3, discount: 0.1 },
    { id: "q5", title: "Mua 5 sản phẩm", description: "Mở gợi ý combo đồng giá.", min: 0, qty: 5, discount: 0.12 }
  ];

  return rules.map((rule) => {
    const moneyOk = rule.min === 0 || subtotal >= rule.min;
    const qtyOk = rule.qty === 0 || count >= rule.qty;
    const missingMoney = Math.max(rule.min - subtotal, 0);
    const missingQty = Math.max(rule.qty - count, 0);
    return {
      ...rule,
      unlocked: moneyOk && qtyOk,
      progress: moneyOk && qtyOk
        ? "Đã tự áp dụng trong tổng tiền."
        : missingMoney > 0
          ? `Thêm ${money(missingMoney)} để mở.`
          : `Thêm ${missingQty} sản phẩm để mở.`
    };
  });
}

export function bestVoucher(items: CartItem[]) {
  return getVouchers(items)
    .filter((voucher) => voucher.unlocked)
    .sort((a, b) => Number(b.freeship) - Number(a.freeship) || b.discount - a.discount)[0];
}

export function checkoutTotals(items: CartItem[]) {
  const subtotal = cartSubtotal(items);
  const voucher = bestVoucher(items);
  const discount = Math.round(subtotal * (voucher?.discount ?? 0));
  const shipping = voucher?.freeship || subtotal === 0 ? 0 : 30000;
  return { subtotal, voucher, discount, shipping, total: Math.max(subtotal - discount + shipping, 0) };
}

export function adviseSize(height: number, weight: number, body: string, fit: string) {
  let base = "M";
  if (height >= 180 || weight >= 78) base = "XL";
  else if (height >= 170 || weight >= 64) base = "L";
  else if (height < 162 && weight < 55) base = "S";

  const relaxed = fit === "oversize" || fit === "rộng nhẹ";
  const order = ["S", "M", "L", "XL"];
  const baseIndex = order.indexOf(base);
  const second = relaxed ? order[Math.min(baseIndex + 1, 3)] : order[Math.max(baseIndex - (body === "gầy" ? 1 : 0), 0)];
  return {
    size: relaxed ? second : base,
    note: `Với chiều cao ${height}cm và cân nặng ${weight}kg, size ${base} sẽ lên form gọn và sạch. Nếu cậu thích mặc ${fit}, ${second} sẽ đẹp hơn nha. Mặc ${base} thì clean, mặc ${second} thì thoải mái và street hơn.`,
    model: `Mẫu gần nhất cao ${height + 3}cm, nặng ${weight + 3}kg đang mặc size ${second}. Form lên rộng nhẹ, vai rũ vừa phải, nhìn thoải mái nhưng vẫn gọn.`
  };
}

export function estimateCustomPrice(quantity: number, printPositions: number, printSize: number, printType: string) {
  const shirtBase = 180000;
  const typeCost = printType === "Thêu" ? 85000 : printType === "DTF" ? 55000 : 40000;
  const printCost = printPositions * (typeCost + printSize * 1200);
  const discount = quantity >= 50 ? 0.86 : quantity >= 25 ? 0.92 : quantity >= 10 ? 1 : 1.08;
  const total = Math.round(quantity * (shirtBase + printCost) * discount);
  const deposit = Math.round(total * 0.4);
  const days = quantity >= 50 ? 14 : quantity >= 25 ? 10 : 7;
  return { total, deposit, days };
}
