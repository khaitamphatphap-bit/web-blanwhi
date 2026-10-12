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

const CURRENT_ORDER_CODE = /^BLW-(\d{12,14})-([A-Z0-9]{4,5})$/i;

function stableCodeHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(5, "0").slice(-5);
}

/**
 * Shop 2's SPX connection adds its own metadata to the merchant order id.
 * Keep our POS alias at 16 characters so the final carrier value stays below
 * SPX's 32-character limit while the full website order code remains intact.
 */
export function shop2SpxOrderCode(code: string) {
  const normalized = shortOrderCode(code);
  const current = normalized.match(CURRENT_ORDER_CODE);
  if (current) {
    const timestamp = current[1].slice(-11);
    return `B${timestamp}${current[2].slice(0, 4)}`;
  }
  if (normalized.length <= 16) return normalized;
  const readable = normalized.replace(/[^A-Z0-9]/g, "").slice(0, 10).padEnd(10, "0");
  return `B${readable}${stableCodeHash(normalized)}`;
}

export function pancakePosOrderCode(code: string, connectionId: "shop-1" | "shop-2" = "shop-1") {
  return connectionId === "shop-2" ? shop2SpxOrderCode(code) : shortOrderCode(code);
}
