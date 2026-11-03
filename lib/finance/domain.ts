export type MoneyCents = bigint
export type MoneyInput = string | number | bigint

export type AccountType = 'checking' | 'savings' | 'cash' | 'credit_card' | 'investment' | 'other'
export type EntryType = 'income' | 'expense' | 'transfer' | 'opening' | 'reversal' | 'adjustment'
export type EntryStatus = 'pending' | 'posted' | 'cancelled'

export interface Account {
  id: string
  name: string
  type: AccountType
  currency: string
  isActive: boolean
  balanceCents: MoneyCents
}

export interface Category {
  id: string
  name: string
  kind: 'income' | 'expense' | 'both'
  parentId: string | null
  isActive: boolean
}

export interface FinancialEntry {
  id: string
  accountId: string
  categoryId: string | null
  type: EntryType
  status: EntryStatus
  amountCents: MoneyCents
  effectiveOn: string
  description: string
  transferGroupId: string | null
  idempotencyKey: string
}

export interface CardInvoice {
  id: string
  accountId: string
  referenceMonth: string
  dueOn: string
  totalCents: MoneyCents
  paidCents: MoneyCents
  status: 'open' | 'partially_paid' | 'paid' | 'cancelled'
}

export interface Debt {
  id: string
  name: string
  principalCents: MoneyCents
  outstandingCents: MoneyCents
  dueOn: string | null
  status: 'open' | 'settled' | 'cancelled'
}

export interface Investment {
  id: string
  name: string
  accountId: string
  investedCents: MoneyCents
  currentValueCents: MoneyCents
  asOf: string
}

export interface FinanceSummary {
  balanceCents: MoneyCents
  incomeCents: MoneyCents
  expenseCents: MoneyCents
  investmentCents: MoneyCents
}

export function parseMoneyCents(value: MoneyInput): MoneyCents {
  if (typeof value === 'bigint') return value
  const input = String(value).trim().replace(/\s/g, '')
  if (!input || !/^-?[0-9.,]+$/.test(input)) throw new Error('Valor monetário inválido.')
  const negative = input.startsWith('-')
  const unsigned = negative ? input.slice(1) : input
  const hasComma = unsigned.includes(',')
  const normalized = hasComma
    ? unsigned.replace(/\./g, '').replace(',', '.')
    : normalizeDotNumber(unsigned)
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Valor monetário inválido.')
  const [whole, fraction = ''] = normalized.split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return negative ? -cents : cents
}

function normalizeDotNumber(value: string): string {
  const parts = value.split('.')
  if (parts.length === 1) return value
  if (parts.slice(1).every((part) => part.length === 3)) return parts.join('')
  if (parts.length !== 2) throw new Error('Valor monetário inválido.')
  return value
}

export function sanitizeMoneyInput(value: string): string {
  return value.replace(/[^0-9.,]/g, '')
}

export function formatMoneyInput(value: string): string {
  const cents = parseMoneyCents(value)
  const absolute = cents < 0n ? -cents : cents
  const whole = absolute / 100n
  const fraction = String(absolute % 100n).padStart(2, '0')
  return `${cents < 0n ? '-' : ''}${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${fraction}`
}

export function formatMoneyCents(value: MoneyCents, currency = 'BRL'): string {
  const negative = value < 0n
  const absolute = negative ? -value : value
  const whole = absolute / 100n
  const cents = String(absolute % 100n).padStart(2, '0')
  const groupedWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const symbol = new Intl.NumberFormat('pt-BR', { style: 'currency', currency })
    .formatToParts(0)
    .find((part) => part.type === 'currency')?.value ?? currency
  return `${negative ? '-' : ''}${symbol} ${groupedWhole},${cents}`
}

export function summarizeEntries(entries: Array<Pick<FinancialEntry, 'type' | 'status' | 'amountCents'>>): FinanceSummary {
  let balanceCents = 0n
  let incomeCents = 0n
  let expenseCents = 0n
  for (const entry of entries) {
    if (entry.status !== 'posted') continue
    if (entry.type === 'income' || entry.type === 'reversal') {
      incomeCents += entry.amountCents
      balanceCents += entry.amountCents
    } else if (entry.type === 'expense') {
      expenseCents += entry.amountCents
      balanceCents -= entry.amountCents
    }
  }
  return { balanceCents, incomeCents, expenseCents, investmentCents: 0n }
}
