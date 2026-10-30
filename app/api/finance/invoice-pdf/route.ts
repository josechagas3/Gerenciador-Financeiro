import { NextResponse } from 'next/server'
import { extractInvoicePdf } from '@/lib/finance/invoice-pdf-extractor'
import { createFinanceServerRepository, FinancePersistenceError } from '@/lib/finance/server-repository'

const MAX_PDF_BYTES = 15 * 1024 * 1024

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const file = form.get('file')
    const invoiceId = form.get('invoiceId')
    if (!(file instanceof File) || file.type !== 'application/pdf' || file.size === 0 || file.size > MAX_PDF_BYTES) return NextResponse.json({ error: 'Envie um arquivo PDF de até 15 MB.' }, { status: 400 })
    if (typeof invoiceId !== 'string' || !invoiceId) return NextResponse.json({ error: 'Fatura inválida.' }, { status: 400 })
    const repository = await createFinanceServerRepository()
    const invoice = (await repository.listInvoices()).find((entry) => entry.id === invoiceId)
    if (!invoice) return NextResponse.json({ error: 'Fatura não encontrada ou sem acesso.' }, { status: 404 })
    const bytes = new Uint8Array(await file.arrayBuffer())
    const extraction = await extractInvoicePdf(bytes, file.name.slice(0, 180))
    return NextResponse.json({ extraction, invoice: { id: invoice.id, totalCents: invoice.totalCents.toString(), items: invoice.items.map((item) => ({ description: item.description, occurredOn: item.occurredOn, totalCents: item.totalCents.toString() })) } }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof FinancePersistenceError) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: 'Não foi possível processar o PDF com segurança.' }, { status: 422 })
  }
}
