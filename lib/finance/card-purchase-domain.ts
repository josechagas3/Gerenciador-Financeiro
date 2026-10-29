export type CardCycle = { closingDay: number; dueDay: number }

export type InstallmentPlan = {
  number: number
  amountCents: bigint
  periodStart: string
  periodEnd: string
  dueOn: string
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10)
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

function cycleEnd(year: number, monthIndex: number, closingDay: number) {
  const day = Math.min(closingDay, daysInMonth(year, monthIndex))
  return new Date(Date.UTC(year, monthIndex, day))
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()))
}

export function planCardInstallments(input: {
  amountCents: bigint
  installmentCount: number
  occurredOn: string
  cycle: CardCycle
}) : InstallmentPlan[] {
  if (input.amountCents <= 0n) throw new Error('amount must be positive')
  if (!Number.isInteger(input.installmentCount) || input.installmentCount < 1 || input.installmentCount > 120) throw new Error('invalid installment count')
  const occurredOn = new Date(`${input.occurredOn}T00:00:00.000Z`)
  if (Number.isNaN(occurredOn.getTime())) throw new Error('invalid purchase date')
  const currentEnd = cycleEnd(occurredOn.getUTCFullYear(), occurredOn.getUTCMonth(), input.cycle.closingDay)
  const firstEnd = occurredOn > currentEnd ? cycleEnd(occurredOn.getUTCFullYear(), occurredOn.getUTCMonth() + 1, input.cycle.closingDay) : currentEnd
  const base = input.amountCents / BigInt(input.installmentCount)
  const remainder = input.amountCents % BigInt(input.installmentCount)
  const plans: InstallmentPlan[] = []

  for (let index = 0; index < input.installmentCount; index += 1) {
    const end = cycleEnd(firstEnd.getUTCFullYear(), firstEnd.getUTCMonth() + index, input.cycle.closingDay)
    const previousEnd = cycleEnd(end.getUTCFullYear(), end.getUTCMonth() - 1, input.cycle.closingDay)
    const dueMonth = addMonths(end, 1)
    const dueDay = Math.min(input.cycle.dueDay, daysInMonth(dueMonth.getUTCFullYear(), dueMonth.getUTCMonth()))
    const dueOn = new Date(Date.UTC(dueMonth.getUTCFullYear(), dueMonth.getUTCMonth(), dueDay))
    plans.push({ number: index + 1, amountCents: base + (BigInt(index + 1) <= remainder ? 1n : 0n), periodStart: dateOnly(new Date(previousEnd.getTime() + 86_400_000)), periodEnd: dateOnly(end), dueOn: dateOnly(dueOn) })
  }
  return plans
}

export function assertInvoiceCanReceivePurchase(status: string) {
  if (status !== 'open') throw new Error('only open invoices can receive purchases')
}

export function simulateAtomicWrite<T>(steps: Array<() => T>, journal: unknown[] = []) {
  const committed: T[] = []
  try {
    for (const step of steps) committed.push(step())
    journal.push(...committed)
    return committed
  } catch (error) {
    journal.length = 0
    throw error
  }
}
