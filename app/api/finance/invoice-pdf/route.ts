import { NextResponse } from 'next/server'
import { extractInvoicePdf } from '@/lib/finance/invoice-pdf-extractor'
import { createFinanceServerRepository, FinancePersistenceError } from '@/lib/finance/server-repository'

const MAX_PDF_BYTES = 15 * 1024 * 1024
const isPdfSignature = (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(request: Request) {
  try {
    const form = await request.formData()
    const file = form.get('file')
    const invoiceId = form.get('invoiceId')
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Selecione um arquivo PDF.' }, { status: 400 })
    if (file.size > MAX_PDF_BYTES) return NextResponse.json({ error: 'O PDF excede o limite de 15 MB.' }, { status: 413 })
    if (invoiceId !== null && typeof invoiceId !== 'string') return NextResponse.json({ error: 'Fatura inválida.' }, { status: 400 })
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!isPdfSignature(bytes)) return NextResponse.json({ error: 'O arquivo selecionado não parece ser um PDF válido.' }, { status: 400 })
    const repository = await createFinanceServerRepository()
    const invoice = invoiceId ? (await repository.listInvoices()).find((entry) => entry.id === invoiceId) : null
    if (invoiceId && !invoice) return NextResponse.json({ error: 'Fatura não encontrada ou sem acesso.' }, { status: 404 })
    const extraction = await extractInvoicePdf(bytes, file.name.slice(0, 180))
    return NextResponse.json({ extraction, invoice: invoice ? { id: invoice.id, totalCents: invoice.totalCents.toString(), items: invoice.items.map((item) => ({ description: item.description, occurredOn: item.occurredOn, totalCents: item.totalCents.toString() })) } : null }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof FinancePersistenceError) return NextResponse.json({ error: error.message }, { status: error.status })
    const details = error instanceof Error ? error.message : String(error)
    const name = error instanceof Error ? error.name : 'UnknownError'
    const status = error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : undefined
    console.error('[v0] Falha na importação de fatura PDF', { name, message: details.slice(0, 500), status })
    if (status === 401 || status === 403) return NextResponse.json({ error: 'O serviço de leitura do PDF não está autenticado no ambiente.' }, { status: 502 })
    if (status === 408 || status === 504 || /timeout|timed out/i.test(details)) return NextResponse.json({ error: 'A leitura do PDF demorou além do limite. Tente novamente com o mesmo arquivo.' }, { status: 504 })
    if (/NoObjectGenerated|schema|validation|structured output/i.test(`${name} ${details}`)) return NextResponse.json({ error: 'O PDF foi recebido, mas os dados não puderam ser estruturados com segurança.' }, { status: 422 })
    return NextResponse.json({ error: 'O PDF foi recebido, mas o serviço de leitura não conseguiu processá-lo.' }, { status: 422 })
  }
}
