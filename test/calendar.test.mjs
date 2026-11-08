import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, monthGrid } from '../shared/calendar.js'

test('month grid starts on Monday and spans six weeks', () => {
  const sep = monthGrid(2026, 8) // September 2026 starts on a Tuesday
  assert.equal(sep.length, 42)
  assert.deepEqual(sep[0], { date: '2026-08-31', day: 31, inMonth: false })
  assert.deepEqual(sep[1], { date: '2026-09-01', day: 1, inMonth: true })
  assert.equal(sep.filter((c) => c.inMonth).length, 30)
  assert.equal(monthGrid(2026, 5)[0].date, '2026-06-01') // June 2026 starts on a Monday
})

test('adding days crosses months and years', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
})
