// Date helpers for the calendar and the board's due dates. Days are local 'YYYY-MM-DD' strings.

/** @param {Date} d */
export const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** @param {string} iso @param {number} n */
export const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number)
  return isoDay(new Date(y, m - 1, d + n))
}

// Six weeks starting on the Monday on or before the 1st: the grid every month view shows.
/** @param {number} year @param {number} month 0-11 @returns {{ date: string, day: number, inMonth: boolean }[]} */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1)
  const back = (first.getDay() + 6) % 7 // days since Monday
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(year, month, 1 - back + i)
    return { date: isoDay(d), day: d.getDate(), inMonth: d.getMonth() === month }
  })
}
