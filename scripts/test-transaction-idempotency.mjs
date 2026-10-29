import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

function hashRequest(value) {
  const serialized = JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item)
  return createHash('sha256').update(serialized).digest('hex')
}

function createTransactionStore() {
  const keys = new Map()
  const transactions = []
  const audit = []

  return {
    create({ userId, accountId, categoryId, type, amountCents, effectiveOn, description, idempotencyKey, requestHash, failAfterReservation = false }) {
      const existingKey = keys.get(idempotencyKey)
      if (existingKey) {
        if (existingKey.userId !== userId || existingKey.operation !== 'create_transaction' || existingKey.requestHash !== requestHash) {
          throw new Error('idempotency key was already used with a different request')
        }
        const existingTransaction = transactions.find((transaction) => transaction.operationKey === idempotencyKey && transaction.userId === userId)
        assert.ok(existingTransaction, 'idempotency reservation must have a transaction')
        return existingTransaction
      }

      keys.set(idempotencyKey, { userId, operation: 'create_transaction', requestHash, responseStatus: null, completedAt: null })
      try {
        if (failAfterReservation) throw new Error('simulated transaction failure')
        const transaction = { id: `tx-${transactions.length + 1}`, userId, accountId, categoryId, type, amountCents, effectiveOn, description, operationKey: idempotencyKey, status: 'posted' }
        transactions.push(transaction)
        const key = keys.get(idempotencyKey)
        key.responseStatus = 201
        key.responseBody = { transaction_id: transaction.id }
        key.completedAt = 'completed'
        audit.push(transaction.id)
        return transaction
      } catch (error) {
        keys.delete(idempotencyKey)
        throw error
      }
    },
    keys,
    transactions,
    audit,
  }
}

const input = {
  accountId: 'account-test',
  categoryId: 'category-test',
  type: 'income',
  amountCents: 1000n,
  effectiveOn: '2026-10-29',
  description: 'teste',
  idempotencyKey: 'idempotency-test-001',
  originalTransactionId: null,
}
const userId = 'user-test'
const requestHash = hashRequest({ ...input, userId })
assert.equal(requestHash.length, 64)
assert.equal(hashRequest({ ...input, userId }), requestHash)
assert.notEqual(hashRequest({ ...input, amountCents: 1001n, userId }), requestHash)

const store = createTransactionStore()
const first = store.create({ ...input, userId, requestHash })
assert.equal(store.transactions.length, 1)
assert.deepEqual(store.keys.get(input.idempotencyKey), {
  userId,
  operation: 'create_transaction',
  requestHash,
  responseStatus: 201,
  responseBody: { transaction_id: first.id },
  completedAt: 'completed',
})
assert.deepEqual(store.audit, [first.id])

const repeated = store.create({ ...input, userId, requestHash })
assert.equal(repeated.id, first.id)
assert.equal(store.transactions.length, 1)
assert.deepEqual(store.audit, [first.id])

assert.throws(() => store.create({ ...input, userId, requestHash: hashRequest({ ...input, amountCents: 1001n, userId }) }), /different request/)
assert.throws(() => store.create({ ...input, userId: 'other-user', requestHash }), /different request/)

const rollbackStore = createTransactionStore()
assert.throws(() => rollbackStore.create({ ...input, userId, requestHash, idempotencyKey: 'idempotency-test-rollback', failAfterReservation: true }), /simulated transaction failure/)
assert.equal(rollbackStore.keys.size, 0)
assert.equal(rollbackStore.transactions.length, 0)
assert.equal(rollbackStore.audit.length, 0)

console.log('transaction idempotency model: passed')
