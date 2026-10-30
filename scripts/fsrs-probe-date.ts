/** tiny date helper: add n days to a Date-like input */
export function addDays(d: Date | string, n: number): Date {
  const base = new Date(d)
  base.setDate(base.getDate() + n)
  return base
}
