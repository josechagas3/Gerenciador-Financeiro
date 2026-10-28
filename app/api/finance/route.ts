import { NextResponse } from 'next/server'
import { createFinanceServerRepository, FinancePersistenceDisabledError } from '@/lib/finance/server-repository'

export async function GET() {
  const repository = await createFinanceServerRepository()
  if (!repository.user) {
    return NextResponse.json({ error: 'Autenticação necessária.' }, { status: 401 })
  }
  return NextResponse.json({ error: new FinancePersistenceDisabledError().message }, { status: 503 })
}
