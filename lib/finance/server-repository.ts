import { createHash, randomUUID } from 'node:crypto'
import { parseMoneyCents, type Account, type Category, type FinancialEntry, type MoneyCents } from './domain'
import { requireDate, requireText, validateEntryInput } from './validation'

export class FinancePersistenceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'FinancePersistenceError'
  }
}

export type FinanceCard = {
  id: string
  accountId: string
  name: string
  brand: string
  creditLimitCents: MoneyCents
  usedCents: MoneyCents
  availableCents: MoneyCents
  closingDay: number
  dueDay: number
}

export type FinanceInvoice = {
  id: string
  cardId: string | null
  accountId: string
  periodStart: string
  periodEnd: string
  dueOn: string
  totalCents: MoneyCents
  paidCents: MoneyCents
  status: string
  items: Array<{ id: string; transactionId: string; description: string; occurredOn: string; totalCents: MoneyCents }>
}

export type FinanceSnapshot = {
  accounts: Account[]
  categories: Category[]
  movements: FinancialEntry[]
  cards: FinanceCard[]
  invoices: FinanceInvoice[]
  cardsAvailable: boolean
}

type Row = Record<string, unknown>

function asMoney(value: unknown): MoneyCents {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value)
  throw new FinancePersistenceError('Valor monetário retornado pelo banco é inválido.', 500)
}

function mapAccount(row: Row): Account {
  return { id: String(row.id), name: String(row.name), type: row.account_type as Account['type'], currency: String(row.currency_code).trim(), isActive: Boolean(row.is_active), balanceCents: 0n }
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
  const serialized = JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item)
  return createHash('sha256').update(serialized).digest('hex')
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

function isMissingCreditCardsTable(error: { code?: string; message?: string } | null) {
  return error?.code === '42P01' || error?.code === 'PGRST205' || /credit_cards.*(does not exist|not found)|relation .*credit_cards/i.test(error?.message ?? '')
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
    return (data ?? []).filter((row) => row.status !== 'cancelled').map(mapMovement)
  }
  async function listCards(): Promise<{ cards: FinanceCard[]; available: boolean }> {
    const { data: cards, error } = await db.from('credit_cards').select('id,account_id,name,brand,credit_limit_cents,closing_day,due_day').eq('user_id', user.id).order('name')
    if (error && isMissingCreditCardsTable(error)) return { cards: [], available: false }
    if (error) throw new FinancePersistenceError('Não foi possível carregar os cartões.', 500)
    const accountIds = (cards ?? []).map((card) => card.account_id)
    const { data: movements, error: movementsError } = accountIds.length ? await db.from('transactions').select('account_id,transaction_type,status,amount_cents').in('account_id', accountIds).eq('user_id', user.id) : { data: [], error: null }
    if (movementsError) throw new FinancePersistenceError('Não foi possível calcular o limite utilizado.', 500)
    const used = new Map<string, bigint>()
    for (const movement of movements ?? []) {
      if (movement.status !== 'posted') continue
      const amount = asMoney(movement.amount_cents)
      const signed = movement.transaction_type === 'expense' ? amount : movement.transaction_type === 'income' || movement.transaction_type === 'reversal' ? -amount : 0n
      used.set(movement.account_id, (used.get(movement.account_id) ?? 0n) + signed)
    }
    return { available: true, cards: (cards ?? []).map((card) => {
      const limit = asMoney(card.credit_limit_cents)
      const usedCents = used.get(card.account_id) ?? 0n

      return { id: String(card.id), accountId: String(card.account_id), name: String(card.name), brand: String(card.brand), creditLimitCents: limit, usedCents, availableCents: limit - usedCents, closingDay: Number(card.closing_day), dueDay: Number(card.due_day) }
    }) }
  }
  async function listInvoices(): Promise<FinanceInvoice[]> {
    const { data: invoices, error } = await db.from('card_invoices').select('id,account_id,period_start,period_end,due_on,total_cents,status').eq('user_id', user.id).order('due_on', { ascending: false })
    if (error) throw new FinancePersistenceError('Não foi possível carregar as faturas.', 500)
    const invoiceIds = (invoices ?? []).map((invoice) => invoice.id)
    const { data: items, error: itemsError } = invoiceIds.length ? await db.from('card_invoice_items').select('id,invoice_id,transaction_id,total_cents,transactions(description,occurred_at)').eq('user_id', user.id).in('invoice_id', invoiceIds) : { data: [], error: null }
    if (itemsError) throw new FinancePersistenceError('Não foi possível carregar as compras das faturas.', 500)
    const { data: payments, error: paymentsError } = invoiceIds.length ? await db.from('card_payments').select('invoice_id,paid_cents').eq('user_id', user.id).in('invoice_id', invoiceIds) : { data: [], error: null }
    if (paymentsError) throw new FinancePersistenceError('Não foi possível carregar os pagamentos das faturas.', 500)
    const paid = new Map<string, bigint>()
    for (const payment of payments ?? []) paid.set(payment.invoice_id, (paid.get(payment.invoice_id) ?? 0n) + asMoney(payment.paid_cents))
    const cardLookup = await db.from('credit_cards').select('id,account_id').eq('user_id', user.id)
    if (cardLookup.error && !isMissingCreditCardsTable(cardLookup.error)) throw new FinancePersistenceError('Não foi possível relacionar as faturas aos cartões.', 500)
    const cardByAccount = new Map((cardLookup.data ?? []).map((card) => [card.account_id, String(card.id)]))
    return (invoices ?? []).map((invoice) => ({
      id: String(invoice.id), cardId: cardByAccount.get(invoice.account_id) ?? null, accountId: String(invoice.account_id), periodStart: String(invoice.period_start), periodEnd: String(invoice.period_end), dueOn: String(invoice.due_on), totalCents: asMoney(invoice.total_cents), paidCents: paid.get(invoice.id) ?? 0n, status: String(invoice.status),
      items: (items ?? []).filter((item) => item.invoice_id === invoice.id).map((item) => { const transaction = Array.isArray(item.transactions) ? item.transactions[0] : item.transactions as { description?: string; occurred_at?: string } | null; return { id: String(item.id), transactionId: String(item.transaction_id), description: transaction?.description ?? 'Compra no cartão', occurredOn: transaction?.occurred_at ? new Date(transaction.occurred_at).toISOString().slice(0, 10) : '', totalCents: asMoney(item.total_cents) } })
    }))
  }
  async function createCard(input: Row) {
    const name = requireText(input.name, 'Nome do cartão', 120); const brand = requireText(input.brand, 'Bandeira', 40); const accountId = requireText(input.accountId, 'Conta do cartão', 80); const creditLimitCents = parseMoneyCents(input.creditLimitCents as string | number | bigint); const closingDay = Number(input.closingDay); const dueDay = Number(input.dueDay)
    if (creditLimitCents <= 0n || !Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31 || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new FinancePersistenceError('Limite, fechamento e vencimento inválidos.')
    const result = await db.from('credit_cards').insert({ name, brand, account_id: accountId, credit_limit_cents: creditLimitCents.toString(), closing_day: closingDay, due_day: dueDay, user_id: user.id }).select('id,account_id,name,brand,credit_limit_cents,closing_day,due_day').single()
    await throwIfError(result, 'Não foi possível criar o cartão.')
    return result.data
  }
  async function updateCard(id: unknown, input: Row) {
    const result = await db.from('credit_cards').update({ name: requireText(input.name, 'Nome do cartão', 120), brand: requireText(input.brand, 'Bandeira', 40), credit_limit_cents: parseMoneyCents(input.creditLimitCents as string | number | bigint).toString(), closing_day: Number(input.closingDay), due_day: Number(input.dueDay) }).eq('id', requireText(id, 'Cartão', 80)).eq('user_id', user.id).select('id,account_id,name,brand,credit_limit_cents,closing_day,due_day').single()
    await throwIfError(result, 'Não foi possível atualizar o cartão.')
    return result.data
  }
  async function deleteCard(id: unknown) {
    const result = await db.from('credit_cards').delete().eq('id', requireText(id, 'Cartão', 80)).eq('user_id', user.id)
    await throwIfError(result, 'Não é possível excluir um cartão com faturas ou lançamentos relacionados.')
  }
  async function registerCardPurchase(input: Row) {
    const invoiceId = requireText(input.invoiceId, 'Fatura', 80)
    const description = requireText(input.description, 'Descrição da compra', 240)
    const amountCents = parseMoneyCents(input.amountCents as string | number | bigint)
    const occurredOn = requireDate(input.occurredOn, 'Data da compra')
    const installmentCount = Number(input.installmentCount ?? 1)
    const operationKey = requireText(input.operationKey, 'Chave da operação', 200)
    const categoryId = requireText(input.categoryId, 'Categoria', 80)
    const requestHash = hashRequest({ invoiceId, categoryId, description, amountCents: amountCents.toString(), occurredOn, installmentCount, userId: user.id })
    if (amountCents <= 0n || !Number.isInteger(installmentCount) || installmentCount < 1 || installmentCount > 120) throw new FinancePersistenceError('Valor e quantidade de parcelas inválidos.')
    const result = await db.rpc('register_card_purchase', { p_invoice_id: invoiceId, p_category_id: categoryId, p_description: description, p_amount_cents: amountCents.toString(), p_occurred_on: occurredOn, p_installment_count: installmentCount, p_operation_key: operationKey, p_request_hash: requestHash })
    await throwIfError(result, 'Não foi possível registrar a compra na fatura.')
    return result.data
  }
  async function registerInvoicePayment(input: Row) {
    const invoiceId = requireText(input.invoiceId, 'Fatura', 80); const paymentTransactionId = requireText(input.paymentTransactionId, 'Lançamento do pagamento', 80); const operationKey = requireText(input.operationKey, 'Chave da operação', 200); const paidCents = parseMoneyCents(input.paidCents as string | number | bigint)
    if (paidCents <= 0n) throw new FinancePersistenceError('O pagamento deve ser maior que zero.')
    const invoice = await db.from('card_invoices').select('id').eq('id', invoiceId).eq('user_id', user.id).single(); await throwIfError(invoice, 'Não foi possível localizar a fatura.')
    const transaction = await db.from('transactions').select('id,transaction_type,status').eq('id', paymentTransactionId).eq('user_id', user.id).single(); await throwIfError(transaction, 'Não foi possível localizar o lançamento do pagamento.')
    if (transaction.data?.status !== 'posted' || transaction.data?.transaction_type !== 'transfer') throw new FinancePersistenceError('O pagamento da fatura deve ser um lançamento de transferência publicado.')
    const result = await db.from('card_payments').insert({ invoice_id: invoiceId, payment_transaction_id: paymentTransactionId, paid_cents: paidCents.toString(), paid_at: new Date().toISOString(), operation_key: operationKey, user_id: user.id }).select('id,invoice_id,payment_transaction_id,paid_cents,paid_at,operation_key').single()
    await throwIfError(result, 'Não foi possível registrar o pagamento da fatura.')
    return result.data
  }
  async function snapshot(): Promise<FinanceSnapshot> {
    const [accounts, categories, movements, cardResult, invoices] = await Promise.all([listAccounts(), listCategories(), listMovements(), listCards(), listInvoices()])
    const cards = cardResult.cards
    const balances = new Map<string, bigint>()
    for (const movement of movements) {
      if (movement.status !== 'posted') continue
      const signedAmount = movement.type === 'expense' ? -movement.amountCents : movement.amountCents
      balances.set(movement.accountId, (balances.get(movement.accountId) ?? 0n) + signedAmount)
    }
    return { accounts: accounts.map((account) => ({ ...account, balanceCents: balances.get(account.id) ?? 0n })), categories, movements, cards, invoices, cardsAvailable: cardResult.available }
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
    const requestHash = hashRequest({ ...entry, userId: user.id })
    const result = await db.rpc('create_transaction', {
      p_account_id: entry.accountId,
      p_category_id: entry.categoryId,
      p_transaction_type: entry.type,
      p_amount_cents: entry.amountCents.toString(),
      p_occurred_at: `${entry.effectiveOn}T00:00:00.000Z`,
      p_description: entry.description,
      p_operation_key: entry.idempotencyKey,
      p_request_hash: requestHash,
      p_original_transaction_id: entry.originalTransactionId ?? null,
    })
    await throwIfError(result, 'Não foi possível criar o lançamento.')
    return mapMovement(result.data as Row)
  }
  async function updateEntry(id: unknown, input: Row) {
    const entryId = requireText(id, 'Lançamento', 80); const entry = validateEntryInput({ ...input, idempotencyKey: input.idempotencyKey ?? `update:${entryId}` })
    const reversal = await db.from('transactions').select('id').eq('original_transaction_id', entryId).eq('user_id', user.id).limit(1).maybeSingle()
    if (reversal.error) throw new FinancePersistenceError('Não foi possível verificar o histórico do lançamento.', 500)
    if (reversal.data) throw new FinancePersistenceError('Lançamentos estornados não podem ser editados.', 409)
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
    if (row.status !== 'posted' || !['income', 'expense'].includes(String(row.transaction_type))) throw new FinancePersistenceError('Somente receitas e despesas publicadas podem ser estornadas.')
    return createEntry({ accountId: row.account_id, categoryId: row.category_id, type: row.transaction_type === 'expense' ? 'income' : 'expense', amountCents: asMoney(row.amount_cents).toString(), effectiveOn: new Date().toISOString().slice(0, 10), description: `Estorno: ${row.description}`, idempotencyKey: `reversal:${originalId}`, originalTransactionId: originalId })
  }
  return { user, snapshot, listCards, listInvoices, createCard, updateCard, deleteCard, registerCardPurchase, registerInvoicePayment, createAccount, updateAccount, deleteAccount, createCategory, updateCategory, deleteCategory, createEntry, updateEntry, cancelEntry, reverseEntry }
}
