/** Calendar dates as local "YYYY-MM-DD" strings (no time zones), weeks running Monday to Sunday. */

const pad = (n: number) => String(n).padStart(2, '0')

export const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(iso: string, days: number): string {
  const d = fromIso(iso)
  d.setDate(d.getDate() + days)
  return toIso(d)
}

export function mondayOf(iso: string): string {
  const d = fromIso(iso)
  return addDays(iso, -((d.getDay() + 6) % 7))
}

export const today = () => toIso(new Date())

export const isValidIso = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(fromIso(s).getTime())

/** "Mon 16 Nov" */
export const dayLabel = (iso: string) =>
  fromIso(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/** "16 Nov 2026" */
export const longDate = (iso: string) =>
  fromIso(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
