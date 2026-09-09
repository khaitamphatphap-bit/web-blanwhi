const checkoutVoucherRules = [
  { code: "BLANWHI5", minimumSubtotal: 500_000, rate: 0.05 },
  { code: "BLANWHI10", minimumSubtotal: 1_000_000, rate: 0.1 },
  { code: "BLANWHI15", minimumSubtotal: 2_000_000, rate: 0.15 }
] as const;

function money(value: unknown) {
  const parsed = Number(value);
  return Math.max(0, Math.floor(Number.isFinite(parsed) ? parsed : 0));
}

function voucherCode(value: unknown) {
  return String(value || "").trim().toUpperCase().slice(0, 40);
}

export function resolveCheckoutDiscount(subtotalValue: unknown, voucherCodeValue: unknown) {
  const subtotal = money(subtotalValue);
  const code = voucherCode(voucherCodeValue);
  if (!code) return { valid: true as const, voucherCode: "", discount: 0 };

  const rule = checkoutVoucherRules.find((candidate) => candidate.code === code);
  if (!rule) {
    return { valid: false as const, voucherCode: code, discount: 0, message: "Mã giảm giá không hợp lệ. Vui lòng kiểm tra lại giỏ hàng." };
  }
  if (subtotal < rule.minimumSubtotal) {
    return { valid: false as const, voucherCode: code, discount: 0, message: "Đơn hàng chưa đủ điều kiện áp dụng mã giảm giá. Vui lòng kiểm tra lại giỏ hàng." };
  }

  return {
    valid: true as const,
    voucherCode: code,
    discount: Math.round(subtotal * rule.rate)
  };
}
