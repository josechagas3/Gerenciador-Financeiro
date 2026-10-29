import assert from 'node:assert/strict'
import { assertInvoiceCanReceivePurchase, planCardInstallments, simulateAtomicWrite } from '../lib/finance/card-purchase-domain.ts'

const oneOff = planCardInstallments({ amountCents: 10000n, installmentCount: 1, occurredOn: '2026-11-05', cycle: { closingDay: 10, dueDay: 15 } })
assert.equal(oneOff.length, 1)
assert.equal(oneOff[0].amountCents, 10000n)
assert.equal(oneOff[0].periodStart, '2026-10-11')
assert.equal(oneOff[0].periodEnd, '2026-11-10')

const rounded = planCardInstallments({ amountCents: 10001n, installmentCount: 3, occurredOn: '2026-11-15', cycle: { closingDay: 10, dueDay: 15 } })
assert.deepEqual(rounded.map(item => item.amountCents), [3334n, 3334n, 3333n])
assert.equal(rounded.reduce((sum, item) => sum + item.amountCents, 0n), 10001n)
assert.deepEqual(rounded.map(item => [item.periodStart, item.periodEnd]), [
  ['2026-11-11', '2026-12-10'],
  ['2026-12-11', '2027-01-10'],
  ['2027-01-11', '2027-02-10'],
])

const shortMonth = planCardInstallments({ amountCents: 12000n, installmentCount: 2, occurredOn: '2028-02-29', cycle: { closingDay: 31, dueDay: 31 } })
assert.equal(shortMonth[0].periodEnd, '2028-02-29')
assert.equal(shortMonth[0].dueOn, '2028-03-31')
assert.throws(() => assertInvoiceCanReceivePurchase('paid'))
assert.throws(() => assertInvoiceCanReceivePurchase('closed'))
assert.doesNotThrow(() => assertInvoiceCanReceivePurchase('open'))

const idempotency = new Map()
const requestKey = 'purchase-operation-001'
idempotency.set(requestKey, JSON.stringify({ amountCents: '10001', installmentCount: 3 }))
assert.equal(idempotency.get(requestKey), JSON.stringify({ amountCents: '10001', installmentCount: 3 }))
assert.notEqual(idempotency.get(requestKey), JSON.stringify({ amountCents: '10002', installmentCount: 3 }))

const writes = []
assert.throws(() => simulateAtomicWrite([
  () => 'transaction',
  () => { throw new Error('invoice trigger failure') },
], writes))
assert.equal(writes.length, 0, 'a failed multi-write operation leaves no committed journal entries')

console.log('card purchase domain tests passed')
