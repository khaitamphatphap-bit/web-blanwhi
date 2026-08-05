const LEGACY_ORDER_CODE = /^BLW-\d{2}(\d{12})-([A-Z0-9]{5})$/i;

/**
 * Converts the former 24-character website code to a 22-character
 * SPX-compatible code. The conversion is deterministic so payment callbacks
 * can keep using the original stored code while customer/POS views use the
 * same short alias every time.
 */
export function shortOrderCode(code: string) {
  const normalized = String(code || "").trim().toUpperCase();
  const legacy = normalized.match(LEGACY_ORDER_CODE);
  return legacy ? `BLW-${legacy[1]}-${legacy[2]}` : normalized;
}