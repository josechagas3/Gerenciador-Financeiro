import { FinancePersistenceError, getFinanceAuthContext } from './server-repository'

type Row = Record<string, unknown>

export type RecurringPlan = {
  id: string
  accountId: string
  categoryId: string
  description: string
  type: 'income' | 'expense'
  amountCents: string
  frequency: 'monthly'
  dueDay: number
  startsOn: string
  endsOn: string | null
  isActive: boolean
}

export type RecurringOccurrence = {
  id: string
  planId: string
  period: string
  dueOn: string
  amountCents: string
  status: 'planned' | 'realized' | 'cancelled'
  transactionId: string | null
  realizedAt: string | null
}

export type RecurringSnapshot = {
  plans: RecurringPlan[]
  occurrences: RecurringOccurrence[]
}

function text(value: unknown) {
  return String(value)
}

function mapPlan(row: Row): RecurringPlan {
  return {
    id: text(row.id),
    accountId: text(row.account_id),
    categoryId: text(row.category_id),
    description: text(row.description),
    type: row.plan_type as RecurringPlan['type'],
    amountCents: text(row.amount_cents),
    frequency: 'monthly',
    dueDay: Number(row.due_day),
    startsOn: text(row.starts_on),
    endsOn: row.ends_on ? text(row.ends_on) : null,
    isActive: Boolean(row.is_active),
  }
}

function mapOccurrence(row: Row): RecurringOccurrence {
  return {
    id: text(row.id),
    planId: text(row.plan_id),
    period: text(row.period),
    dueOn: text(row.due_on),
    amountCents: text(row.amount_cents),
    status: row.status as RecurringOccurrence['status'],
    transactionId: row.transaction_id ? text(row.transaction_id) : null,
    realizedAt: row.realized_at ? text(row.realized_at) : null,
  }
}

const RECURRING_WRITES_ENABLED = false

function writesBlocked(): never {
  throw new FinancePersistenceError('A persistência de recorrências está bloqueada até a revisão e aplicação da migration.', 503)
}

export async function createRecurringServerRepository() {
  const context = await getFinanceAuthContext()
  if (!context.user) throw new FinancePersistenceError('Autenticação necessária.', 401)

  const db = context.supabase.schema('finance')
  const userId = context.user.id

  async function snapshot(): Promise<RecurringSnapshot> {
    const [plansResult, occurrencesResult] = await Promise.all([
      db.from('recurring_plans')
        .select('id,account_id,category_id,description,plan_type,amount_cents,frequency,due_day,starts_on,ends_on,is_active')
        .eq('user_id', userId)
        .order('starts_on', { ascending: true }),
      db.from('recurring_occurrences')
        .select('id,plan_id,period,due_on,amount_cents,status,transaction_id,realized_at')
        .eq('user_id', userId)
        .order('period', { ascending: true })
        .order('due_on', { ascending: true }),
    ])

    if (plansResult.error || occurrencesResult.error) {
      throw new FinancePersistenceError('A persistência de recorrências ainda não está disponível neste ambiente.', 503)
    }

    return {
      plans: (plansResult.data ?? []).map(mapPlan),
      occurrences: (occurrencesResult.data ?? []).map(mapOccurrence),
    }
  }

  return {
    user: context.user,
    snapshot,
    createPlan: async (_input: Row) => writesBlocked(),
    updatePlan: async (_id: unknown, _input: Row) => writesBlocked(),
    cancelPlan: async (_id: unknown) => writesBlocked(),
    realizeOccurrence: async (occurrenceId: unknown, operationKey?: unknown, requestHash?: unknown) => {
      if (!RECURRING_WRITES_ENABLED) writesBlocked()
      const { data, error } = await db.rpc('realize_recurring_occurrence', {
        p_occurrence_id: String(occurrenceId),
        p_operation_key: String(operationKey),
        p_request_hash: String(requestHash),
      })
      if (error) throw new FinancePersistenceError('Não foi possível confirmar a ocorrência recorrente.', 409)
      return data?.[0] ?? null
    },
    cancelOccurrence: async (_id: unknown) => writesBlocked(),
  }
}
