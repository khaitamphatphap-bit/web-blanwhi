export type StandardShippingPricing = {
  baseFee: number;
  discount: number;
  chargedFee: number;
  qualifiesForFreeShipping: boolean;
};

function money(value: unknown) {
  const parsed = Number(value);
  return Math.max(0, Math.floor(Number.isFinite(parsed) ? parsed : 0));
}

export function calculateStandardShipping(input: {
  subtotal: unknown;
  defaultFee: unknown;
  freeShippingEnabled: boolean;
  freeShippingThreshold: unknown;
}): StandardShippingPricing {
  const subtotal = money(input.subtotal);
  const baseFee = subtotal > 0 ? money(input.defaultFee) : 0;
  const threshold = money(input.freeShippingThreshold);
  const qualifiesForFreeShipping = subtotal > 0
    && baseFee > 0
    && input.freeShippingEnabled
    && threshold > 0
    && subtotal >= threshold;
  const discount = qualifiesForFreeShipping ? baseFee : 0;

  return {
    baseFee,
    discount,
    chargedFee: Math.max(0, baseFee - discount),
    qualifiesForFreeShipping
  };
}
