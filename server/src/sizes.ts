export const SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "XXXXL"] as const;
export type Size = (typeof SIZES)[number];

export function normalizeSizeKey(key: string): Size | null {
  const k = key.trim().toUpperCase();
  return (SIZES as readonly string[]).includes(k) ? (k as Size) : null;
}

