import { NextResponse } from 'next/server'
import { createRecurringServerRepository } from '@/lib/finance/recurring-repository'
import { FinancePersistenceError } from '@/lib/finance/server-repository'

function jsonError(error: unknown) {
  if (error instanceof FinancePersistenceError) return NextResponse.json({ error: error.message }, { status: error.status })
  return NextResponse.json({ error: 'Não foi possível carregar o planejamento recorrente.' }, { status: 500 })
}

export async function GET() {
  try {
    const repository = await createRecurringServerRepository()
    return NextResponse.json(await repository.snapshot(), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return jsonError(error)
  }
}

export async function POST(request: Request) {
  try {
    const repository = await createRecurringServerRepository()
    const input = await request.json().catch(() => ({}))
    if (input.action === 'realize') {
      const result = await repository.realizeOccurrence(
        input.occurrenceId,
        input.operationKey,
        input.requestHash,
      )
      return NextResponse.json(result, { status: 200 })
    }
    await repository.createPlan(input)
    return NextResponse.json({ error: 'Operação bloqueada.' }, { status: 503 })
  } catch (error) {
    return jsonError(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const repository = await createRecurringServerRepository()
    const input = await request.json().catch(() => ({}))
    await repository.updatePlan(input.id ?? '', input)
    return NextResponse.json({ error: 'Operação bloqueada.' }, { status: 503 })
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE() {
  try {
    const repository = await createRecurringServerRepository()
    await repository.cancelPlan('')
    return NextResponse.json({ error: 'Operação bloqueada.' }, { status: 503 })
  } catch (error) {
    return jsonError(error)
  }
}
