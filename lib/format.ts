/** Small display formatters shared across UI components. */

export function formatPop(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

export function formatKm(n: number): string {
  return `${n.toFixed(1)} km`;
}
