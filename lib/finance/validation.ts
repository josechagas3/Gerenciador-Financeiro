import { parseMoneyCents, type EntryType, type MoneyInput } from './domain'

export function requireText(value: unknown, field: string, maxLength = 160): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) throw new Error(`${field} inválido.`)
  return value.trim()
}

export function requireDate(value: unknown, field: string): string {
  const date = requireText(value, field, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new Error(`${field} inválido.`)
  return date
}

export function validateEntryInput(input: Record<string, unknown>) {
  const type = requireText(input.type, 'Tipo') as EntryType
  if (!['income', 'expense', 'transfer', 'opening', 'reversal', 'adjustment'].includes(type)) throw new Error('Tipo de lançamento inválido.')
  const amountCents = parseMoneyCents(input.amountCents as MoneyInput)
  if (amountCents <= 0n) throw new Error('O valor deve ser positivo.')
  return {
    accountId: requireText(input.accountId, 'Conta', 80), categoryId: input.categoryId == null || input.categoryId === '' ? null : requireText(input.categoryId, 'Categoria', 80),
    type, amountCents, effectiveOn: requireDate(input.effectiveOn, 'Data'), description: requireText(input.description, 'Descrição', 240),
    idempotencyKey: requireText(input.idempotencyKey, 'Chave de idempotência', 128), originalTransactionId: input.originalTransactionId ? requireText(input.originalTransactionId, 'Lançamento original', 80) : null,
  }
}
