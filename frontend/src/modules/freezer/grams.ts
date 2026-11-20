/** Same display rule as the backend: 400 -> "400 g", 1000 -> "1 kg", 1250 -> "1.25 kg". */
export function formatGrams(g: number): string {
  if (g < 1000) return `${g} g`
  return `${(g / 1000).toFixed(3).replace(/\.?0+$/, '')} kg`
}

/** Read a weight typed as "400", "400g", "400 g", "1kg", "1.5 kg" or "1,5kg". Returns whole grams, or null. */
export function parseGrams(text: string): number | null {
  const m = text.trim().toLowerCase().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(kg|g)?$/)
  if (!m) return null
  const value = parseFloat(m[1]) * (m[2] === 'kg' ? 1000 : 1)
  const g = Math.round(value)
  return g > 0 ? g : null
}
