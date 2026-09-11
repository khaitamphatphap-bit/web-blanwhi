function voucherCode(value: unknown) {
  return String(value || "").trim().toUpperCase().slice(0, 40);
}

export function resolveCheckoutDiscount(_subtotalValue: unknown, voucherCodeValue: unknown) {
  const code = voucherCode(voucherCodeValue);
  if (!code) return { valid: true as const, voucherCode: "", discount: 0 };
  return { valid: false as const, voucherCode: code, discount: 0, message: "Website hiện không áp dụng voucher giảm giá." };
}
