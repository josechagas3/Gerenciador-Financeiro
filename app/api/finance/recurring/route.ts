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

export async function POST() {
  try {
    const repository = await createRecurringServerRepository()
    await repository.createPlan({})
    return NextResponse.json({ error: 'Operação bloqueada.' }, { status: 503 })
  } catch (error) {
    return jsonError(error)
  }
}

export async function PATCH() {
  try {
    const repository = await createRecurringServerRepository()
    await repository.updatePlan('', {})
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
