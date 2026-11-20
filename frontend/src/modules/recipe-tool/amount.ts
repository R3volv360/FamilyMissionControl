/**
 * Ingredient amounts (spec T3): a number typed on the keypad plus a unit tapped from a short list. Amounts
 * already written another way (a skill recipe's "128 g*", "1 bunch") stay exactly as written until changed.
 */

export const UNITS = ['', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp'] as const
export type Unit = (typeof UNITS)[number]
/** The unit picker's value: one of UNITS, or "as written" for amounts kept verbatim. */
export type UnitChoice = Unit | 'written'

export const UNIT_LABELS: Record<UnitChoice, string> = {
  '': 'count', g: 'g', kg: 'kg', ml: 'ml', l: 'l', tsp: 'tsp', tbsp: 'tbsp', written: 'as written',
}

export interface Amount {
  amount: string // the number as typed ("1.5", "½", "1/2"), or the whole text when unit is "written"
  unit: UnitChoice
}

const NUMBER = String.raw`(?:\d+(?:[.,]\d+)?(?:\s*[½¼¾⅓⅔])?|\d+\s*\/\s*\d+|\d+\s+\d+\s*\/\s*\d+|[½¼¾⅓⅔])`
const AMOUNT_RE = new RegExp(String.raw`^(${NUMBER})\s*(g|kg|ml|l|tsp|tbsp)?$`, 'i')
const NUMBER_RE = new RegExp(String.raw`^${NUMBER}$`)

/** Split a stored qty into number + unit; anything else is kept "as written". */
export function parseAmount(qty: string): Amount {
  const text = qty.trim()
  if (!text) return { amount: '', unit: '' }
  const m = AMOUNT_RE.exec(text)
  if (!m) return { amount: text, unit: 'written' }
  return { amount: m[1].replace(/\s+/g, ' '), unit: (m[2]?.toLowerCase() ?? '') as Unit }
}

/** The qty stored in recipe.json: "200 g", "2", "½ tsp", or the text as written. */
export function formatAmount({ amount, unit }: Amount): string {
  const a = amount.trim()
  if (unit === 'written' || !a) return a
  const n = a.replace(/^(\d+),(\d+)$/, '$1.$2') // a comma decimal from the keypad
  return unit ? `${n} ${unit}` : n
}

/** True when the amount box holds something that isn't a number (shown as a gentle warning). */
export function badNumber({ amount, unit }: Amount): boolean {
  return unit !== 'written' && amount.trim() !== '' && !NUMBER_RE.test(amount.trim())
}

/** Changing the unit picker: leaving "as written" keeps the leading number, if any. */
export function changeUnit(current: Amount, unit: UnitChoice): Amount {
  if (unit === 'written') return { amount: formatAmount(current), unit }
  if (current.unit === 'written') {
    const lead = /^\s*(\d+(?:[.,]\d+)?|[½¼¾⅓⅔])/.exec(current.amount)
    return { amount: lead ? lead[1] : '', unit }
  }
  return { ...current, unit }
}
