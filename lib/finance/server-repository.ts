import { createHash, randomUUID } from 'node:crypto'
import { parseMoneyCents, type Account, type Category, type FinancialEntry, type MoneyCents } from './domain'
import { requireDate, requireText, validateEntryInput } from './validation'

export class FinancePersistenceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'FinancePersistenceError'
  }
}

export type FinanceSnapshot = {
  accounts: Account[]
  categories: Category[]
  movements: FinancialEntry[]
}

type Row = Record<string, unknown>

function asMoney(value: unknown): MoneyCents {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value)
  throw new FinancePersistenceError('Valor monetário retornado pelo banco é inválido.', 500)
}

function mapAccount(row: Row): Account {
  return { id: String(row.id), name: String(row.name), type: row.account_type as Account['type'], currency: String(row.currency_code).trim(), isActive: Boolean(row.is_active) }
}

function mapCategory(row: Row): Category {
  return { id: String(row.id), name: String(row.name), kind: row.category_type as Category['kind'], parentId: row.parent_id ? String(row.parent_id) : null, isActive: Boolean(row.is_active) }
}

function mapMovement(row: Row): FinancialEntry {
  return {
    id: String(row.id), accountId: String(row.account_id), categoryId: row.category_id ? String(row.category_id) : null,
    type: row.transaction_type as FinancialEntry['type'], status: row.status as FinancialEntry['status'], amountCents: asMoney(row.amount_cents),
    effectiveOn: new Date(String(row.occurred_at)).toISOString().slice(0, 10), description: String(row.description),
    transferGroupId: row.transfer_group_id ? String(row.transfer_group_id) : null, idempotencyKey: String(row.operation_key),
  }
}

function hashRequest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function getFinanceAuthContext() {
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return { supabase, user: null }
  return { supabase, user: data.user }
}

async function throwIfError(result: { error: { code?: string; message: string } | null }, fallback: string) {
  if (!result.error) return
  const status = result.error.code === '23503' ? 409 : result.error.code === '42501' ? 403 : 400
  throw new FinancePersistenceError(result.error.code === '23503' ? 'Não é possível excluir este registro porque ele possui lançamentos relacionados.' : fallback, status)
}

export async function createFinanceServerRepository() {
  const context = await getFinanceAuthContext()
  if (!context.user) throw new FinancePersistenceError('Autenticação necessária.', 401)
  const { supabase, user } = context
  const db = supabase.schema('finance')

  async function listAccounts() {
    const { data, error } = await db.from('accounts').select('id,name,account_type,currency_code,is_active').eq('user_id', user.id).order('name')
    if (error) throw new FinancePersistenceError('Não foi possível carregar as contas.', 500)
    return (data ?? []).map(mapAccount)
  }
  async function listCategories() {
    const { data, error } = await db.from('categories').select('id,name,category_type,parent_id,is_active').eq('user_id', user.id).order('name')
    if (error) throw new FinancePersistenceError('Não foi possível carregar as categorias.', 500)
    return (data ?? []).map(mapCategory)
  }
  async function listMovements() {
    const { data, error } = await db.from('transactions').select('id,account_id,category_id,transaction_type,status,amount_cents,occurred_at,description,transfer_group_id,operation_key').eq('user_id', user.id).order('occurred_at', { ascending: false })
    if (error) throw new FinancePersistenceError('Não foi possível carregar os lançamentos.', 500)
    return (data ?? []).map(mapMovement)
  }
  async function snapshot(): Promise<FinanceSnapshot> {
    const [accounts, categories, movements] = await Promise.all([listAccounts(), listCategories(), listMovements()])
    return { accounts, categories, movements }
  }
  async function createAccount(input: Row) {
    const name = requireText(input.name, 'Nome da conta', 120)
    const type = requireText(input.type, 'Tipo da conta', 30)
    const openingCents = parseMoneyCents(input.openingCents as string | number | bigint ?? '0')
    if (openingCents < 0n) throw new FinancePersistenceError('O saldo inicial não pode ser negativo.')
    const { data, error } = await db.from('accounts').insert({ name, account_type: type, currency_code: 'BRL', user_id: user.id }).select('id,name,account_type,currency_code,is_active').single()
    await throwIfError({ error }, 'Não foi possível criar a conta.')
    const account = mapAccount(data as Row)
    if (openingCents > 0n) {
      try { await createEntry({ accountId: account.id, categoryId: null, type: 'opening', amountCents: openingCents.toString(), effectiveOn: requireDate(input.openingDate ?? new Date().toISOString().slice(0, 10), 'Data do saldo inicial'), description: 'Saldo inicial', idempotencyKey: `opening:${account.id}` }) } catch (error) { await db.from('accounts').delete().eq('id', account.id).eq('user_id', user.id); throw error }
    }
    return account
  }
  async function updateAccount(id: unknown, input: Row) {
    const accountId = requireText(id, 'Conta', 80); const name = requireText(input.name, 'Nome da conta', 120); const type = requireText(input.type, 'Tipo da conta', 30)
    const result = await db.from('accounts').update({ name, account_type: type }).eq('id', accountId).eq('user_id', user.id).select('id,name,account_type,currency_code,is_active').single()
    await throwIfError(result, 'Não foi possível atualizar a conta.')
    return mapAccount(result.data as Row)
  }
  async function deleteAccount(id: unknown) {
    const result = await db.from('accounts').delete().eq('id', requireText(id, 'Conta', 80)).eq('user_id', user.id)
    await throwIfError(result, 'Não foi possível excluir a conta.')
  }
  async function createCategory(input: Row) {
    const name = requireText(input.name, 'Nome da categoria', 120); const kind = requireText(input.kind, 'Tipo da categoria', 20)
    const parentId = input.parentId ? requireText(input.parentId, 'Categoria pai', 80) : null
    const result = await db.from('categories').insert({ name, category_type: kind, parent_id: parentId, user_id: user.id }).select('id,name,category_type,parent_id,is_active').single()
    await throwIfError(result, 'Não foi possível criar a categoria.')
    return mapCategory(result.data as Row)
  }
  async function updateCategory(id: unknown, input: Row) {
    const result = await db.from('categories').update({ name: requireText(input.name, 'Nome da categoria', 120), category_type: requireText(input.kind, 'Tipo da categoria', 20), parent_id: input.parentId ? requireText(input.parentId, 'Categoria pai', 80) : null }).eq('id', requireText(id, 'Categoria', 80)).eq('user_id', user.id).select('id,name,category_type,parent_id,is_active').single()
    await throwIfError(result, 'Não foi possível atualizar a categoria.')
    return mapCategory(result.data as Row)
  }
  async function deleteCategory(id: unknown) {
    const result = await db.from('categories').delete().eq('id', requireText(id, 'Categoria', 80)).eq('user_id', user.id)
    await throwIfError(result, 'Não foi possível excluir a categoria.')
  }
  async function createEntry(input: Row) {
    const entry = validateEntryInput(input)
    const operationKey = entry.idempotencyKey
    const requestHash = hashRequest({ ...entry, userId: user.id })
    const existing = await db.from('transactions').select('id,account_id,category_id,transaction_type,status,amount_cents,occurred_at,description,transfer_group_id,operation_key').eq('operation_key', operationKey).eq('user_id', user.id).maybeSingle()
    if (existing.error) throw new FinancePersistenceError('Não foi possível verificar a idempotência do lançamento.', 500)
    if (existing.data) return mapMovement(existing.data as Row)
    const idem = await db.from('idempotency_keys').insert({ key: operationKey, operation: 'create_transaction', request_hash: requestHash, user_id: user.id }).select('key').single()
    await throwIfError(idem, 'Não foi possível reservar a operação financeira.')
    const row = { account_id: entry.accountId, category_id: entry.categoryId, transaction_type: entry.type, status: 'posted', amount_cents: entry.amountCents.toString(), entry_sign: entry.type === 'expense' ? -1 : 1, occurred_at: `${entry.effectiveOn}T00:00:00.000Z`, description: entry.description, original_transaction_id: entry.originalTransactionId, operation_key: operationKey, user_id: user.id }
    const result = await db.from('transactions').insert(row).select('id,account_id,category_id,transaction_type,status,amount_cents,occurred_at,description,transfer_group_id,operation_key').single()
    await throwIfError(result, 'Não foi possível criar o lançamento.')
    return mapMovement(result.data as Row)
  }
  async function updateEntry(id: unknown, input: Row) {
    const entryId = requireText(id, 'Lançamento', 80); const entry = validateEntryInput({ ...input, idempotencyKey: input.idempotencyKey ?? `update:${entryId}` })
    const result = await db.from('transactions').update({ category_id: entry.categoryId, transaction_type: entry.type, amount_cents: entry.amountCents.toString(), entry_sign: entry.type === 'expense' ? -1 : 1, occurred_at: `${entry.effectiveOn}T00:00:00.000Z`, description: entry.description, original_transaction_id: entry.originalTransactionId }).eq('id', entryId).eq('user_id', user.id).eq('status', 'posted').select('id,account_id,category_id,transaction_type,status,amount_cents,occurred_at,description,transfer_group_id,operation_key').single()
    await throwIfError(result, 'Não foi possível atualizar o lançamento.')
    return mapMovement(result.data as Row)
  }
  async function cancelEntry(id: unknown) {
    const result = await db.from('transactions').update({ status: 'cancelled' }).eq('id', requireText(id, 'Lançamento', 80)).eq('user_id', user.id).eq('status', 'posted').select('id,account_id,category_id,transaction_type,status,amount_cents,occurred_at,description,transfer_group_id,operation_key').single()
    await throwIfError(result, 'Não foi possível cancelar o lançamento.')
    return mapMovement(result.data as Row)
  }
  async function reverseEntry(id: unknown) {
    const originalId = requireText(id, 'Lançamento', 80); const original = await db.from('transactions').select('id,account_id,category_id,transaction_type,status,amount_cents,occurred_at,description,operation_key').eq('id', originalId).eq('user_id', user.id).single()
    await throwIfError(original, 'Não foi possível localizar o lançamento.')
    const row = original.data as Row
    return createEntry({ accountId: row.account_id, categoryId: row.category_id, type: 'reversal', amountCents: asMoney(row.amount_cents).toString(), effectiveOn: new Date().toISOString().slice(0, 10), description: `Estorno: ${row.description}`, idempotencyKey: `reversal:${originalId}`, originalTransactionId: originalId })
  }
  return { user, snapshot, createAccount, updateAccount, deleteAccount, createCategory, updateCategory, deleteCategory, createEntry, updateEntry, cancelEntry, reverseEntry }
}
