import { NextResponse } from 'next/server'
import { createFinanceServerRepository, FinancePersistenceError } from '@/lib/finance/server-repository'
import { createExtendedRepository } from '@/lib/finance/extended-repository'

function jsonData(value: unknown) {
  return JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item))
}

function jsonError(error: unknown) {
  if (error instanceof FinancePersistenceError) return NextResponse.json({ error: error.message }, { status: error.status })
  if (error instanceof Error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ error: 'Não foi possível concluir a operação.' }, { status: 500 })
}

export async function GET() {
  try {
    const repository = await createFinanceServerRepository()
    const extended = await createExtendedRepository()
    return NextResponse.json(jsonData({ ...(await repository.snapshot()), ...(await extended.snapshot()) }), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return jsonError(error) }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { resource?: string; action?: string; id?: string; data?: Record<string, unknown> }
    const repository = await createFinanceServerRepository()
    const extended = await createExtendedRepository()
    const data = body.data ?? {}
    let result: unknown
    if (body.resource === 'debts' && body.action === 'create') result = await extended.createDebt(data)
    else if (body.resource === 'debts' && body.action === 'payment') result = await extended.payDebt(data)
    else if (body.resource === 'investments' && body.action === 'create') result = await extended.createInvestment(data)
    else if (body.resource === 'investments' && body.action === 'movement') result = await extended.createInvestmentMovement(data)
    else if (body.resource === 'goals' && body.action === 'create') result = await extended.createGoal(data)
    else if (body.resource === 'goals' && body.action === 'contribution') result = await extended.contributeGoal(data)
    else if (body.resource === 'cards' && body.action === 'create') result = await repository.createCard(data)
    else if (body.resource === 'invoices' && body.action === 'register-payment') result = await repository.registerInvoicePayment(data)
    else if (body.resource === 'accounts' && body.action === 'create') result = await repository.createAccount(data)
    else if (body.resource === 'categories' && body.action === 'create') result = await repository.createCategory(data)
    else if (body.resource === 'transactions' && body.action === 'create') result = await repository.createEntry(data)
    else if (body.resource === 'transactions' && body.action === 'reverse') result = await repository.reverseEntry(body.id)
    else if (body.resource === 'transactions' && body.action === 'cancel') result = await repository.cancelEntry(body.id)
    else return NextResponse.json({ error: 'Operação financeira inválida.' }, { status: 400 })
    return NextResponse.json(jsonData({ result }), { status: 201 })
  } catch (error) { return jsonError(error) }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { resource?: string; id?: string; data?: Record<string, unknown> }
    const repository = await createFinanceServerRepository()
    const extended = await createExtendedRepository()
    const data = body.data ?? {}
    const result = body.resource === 'debts' ? await extended.updateDebt(body.id, data) : body.resource === 'goals' ? await extended.updateGoal(body.id, data) : body.resource === 'cards' ? await repository.updateCard(body.id, data) : body.resource === 'accounts' ? await repository.updateAccount(body.id, data) : body.resource === 'categories' ? await repository.updateCategory(body.id, data) : body.resource === 'transactions' ? await repository.updateEntry(body.id, data) : null
    if (!result) return NextResponse.json({ error: 'Recurso inválido.' }, { status: 400 })
    return NextResponse.json(jsonData({ result }))
  } catch (error) { return jsonError(error) }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { resource?: string; id?: string }
    const repository = await createFinanceServerRepository()
    const extended = await createExtendedRepository()
    if (body.resource === 'debts') await extended.deleteDebt(body.id)
    else if (body.resource === 'investments') await extended.deleteInvestment(body.id)
    else if (body.resource === 'goals') await extended.deleteGoal(body.id)
    else if (body.resource === 'cards') await repository.deleteCard(body.id)
    else if (body.resource === 'accounts') await repository.deleteAccount(body.id)
    else if (body.resource === 'categories') await repository.deleteCategory(body.id)
    else return NextResponse.json({ error: 'Recurso inválido.' }, { status: 400 })
    return new NextResponse(null, { status: 204 })
  } catch (error) { return jsonError(error) }
}
