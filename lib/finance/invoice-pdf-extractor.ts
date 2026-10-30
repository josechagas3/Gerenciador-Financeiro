import { generateText, Output } from 'ai'
import { z } from 'zod'

const itemKind = z.enum(['purchase', 'credit', 'refund', 'interest', 'iof', 'annual_fee', 'fee', 'other_charge', 'needs_review'])

// Keep the schema sent to Gemini intentionally simple. Provider structured-output
// compilers reject schemas with large array bounds and many numeric constraints.
const modelItem = z.object({
  kind: itemKind,
  description: z.string(),
  cardIdentifier: z.string().nullable(),
  occurredOn: z.string().nullable(),
  amount: z.string().describe('Valor decimal brasileiro sem símbolo, por exemplo 1234,56'),
  installmentCurrent: z.number().nullable(),
  installmentTotal: z.number().nullable(),
  confidence: z.number(),
})
const modelExtractionSchema = z.object({
  bankName: z.string().nullable(),
  cardIdentifier: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  closingDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  totalAmount: z.string().nullable(),
  openingBalance: z.string().nullable(),
  items: z.array(modelItem),
  payments: z.array(z.object({ description: z.string(), paidAt: z.string().nullable(), amount: z.string(), confidence: z.number() })),
  warnings: z.array(z.string()),
})

const extractedItem = modelItem.extend({
  description: z.string().min(1).max(180),
  installmentCurrent: z.number().int().positive().nullable(),
  installmentTotal: z.number().int().positive().nullable(),
  confidence: z.number().min(0).max(1),
})
const invoiceExtractionSchema = modelExtractionSchema.extend({
  items: z.array(extractedItem).max(500),
  payments: z.array(z.object({ description: z.string().min(1).max(300), paidAt: z.string().nullable(), amount: z.string().min(1).max(40), confidence: z.number().min(0).max(1) })).max(50),
  warnings: z.array(z.string().max(300)).max(30),
})

export type InvoicePdfExtraction = z.infer<typeof invoiceExtractionSchema>

export class InvoicePdfExtractionError extends Error {
  constructor(public readonly stage: 'model' | 'schema-validation', public readonly validationCompleted: boolean, public readonly partialResponse: boolean, message: string) {
    super(message)
    this.name = 'InvoicePdfExtractionError'
  }
}

export async function extractInvoicePdf(file: Uint8Array, filename: string): Promise<InvoicePdfExtraction> {
  let result: Awaited<ReturnType<typeof generateText>>
  try {
    result = await generateText({
    model: 'google/gemini-2.5-flash',
    output: Output.object({ name: 'CardInvoiceExtraction', schema: modelExtractionSchema }),
    maxOutputTokens: 12000,
    temperature: 0,
    instructions: 'Você extrai dados de faturas brasileiras. Nunca invente valores. Use null quando algo não estiver legível. Trate `P Fat Ent` e `Pagamento Fatura Entrada` como possível operação de pagamento/parcelamento de fatura: classifique como `needs_review`, inclua aviso e exija revisão manual. Trate `Cred P Fat Ent` explicitamente como crédito/ajuste redutor, nunca como pagamento, compra ou `needs_review`. Nunca crie despesa para `P Fat Ent` enquanto não houver confirmação explícita de que é compra parcelada convencional. Datas devem estar em YYYY-MM-DD. Separe pagamentos de compras: pagamentos nunca são itens de despesa. `Cred P Fat Ent` nunca pode aparecer no array `payments`; deve permanecer no array `items` como `credit`. Para valores use vírgula decimal sem símbolo. Identifique o cartão de origem em cada item quando o PDF informar o final; cartões físico e virtual pertencem à mesma fatura. Preserve sinais sem transformar créditos/estornos em receitas. No layout Sicredi, extraia separadamente todas as linhas de crédito e estorno: Estorno CTK Marília (R$ 36,79), Crédito de anuidade (R$ 11,67), Ajuste a crédito de IOF (R$ 0,06) e Ajuste a crédito de IOF (R$ 0,18). Classifique essas quatro linhas como `credit` ou `refund`, nunca como pagamento, compra, encargo ou parte de `Cred P Fat Ent`; não as agrupe nem as descarte. Preserve cada ocorrência mesmo quando a descrição se repetir. Priorize o layout Sicredi, mas aceite outros layouts. Para cada compra parcelada, extraia `installmentCurrent` como o número antes da barra e `installmentTotal` como o número depois da barra: 02/03 significa 2 de 3. Se a fração não estiver legível ou não existir, use null nos campos correspondentes e inclua um aviso; nunca invente 1/1. A linha da fatura representa somente o valor devido neste ciclo: não expanda em despesas anteriores ou futuras. Inclua avisos para qualquer ambiguidade, OCR ruim, campo ausente ou divergência aparente.',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `Leia o PDF ${filename} e extraia a fatura inteira para revisão humana. Identifique compras parceladas, encargos, créditos, estornos e pagamentos separadamente. Não execute nenhuma conciliação.` },
        { type: 'file', data: file, mediaType: 'application/pdf', filename },
      ],
    }],
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 240) : 'erro desconhecido'
    throw new InvoicePdfExtractionError('model', false, Boolean(error && typeof error === 'object' && 'partialOutput' in error), `Falha na resposta estruturada do modelo: ${detail}`)
  }

  if (!result.output) throw new InvoicePdfExtractionError('model', false, false, 'O modelo não retornou uma resposta estruturada.')
  const validated = invoiceExtractionSchema.safeParse(result.output)
  if (!validated.success) {
    throw new InvoicePdfExtractionError('schema-validation', false, true, `A resposta do modelo não passou na validação (${validated.error.issues.length} campos).`)
  }
  const isCredPFatEnt = (description: string) => /cred\s*p\s*fat\s*ent/i.test(description)
  const creditPayments = validated.data.payments.filter((payment) => isCredPFatEnt(payment.description))
  const normalized = {
    ...validated.data,
    items: [
      ...validated.data.items.filter((item) => creditPayments.length === 0 || !isCredPFatEnt(item.description)).map((item) => isCredPFatEnt(item.description) ? { ...item, kind: 'credit' as const, installmentCurrent: null, installmentTotal: null } : item),
      ...creditPayments.map((payment) => ({ kind: 'credit' as const, description: payment.description, cardIdentifier: null, occurredOn: payment.paidAt, amount: payment.amount, installmentCurrent: null, installmentTotal: null, confidence: payment.confidence })),
    ],
    payments: validated.data.payments.filter((payment) => !isCredPFatEnt(payment.description)),
    warnings: creditPayments.length > 0 ? [...validated.data.warnings, 'Cred P Fat Ent foi movido automaticamente de pagamentos para crédito/ajuste redutor.'] : validated.data.warnings,
  }
  console.info('[v0] Importação PDF validada', { stage: 'schema-validation', validationCompleted: true, partialResponse: false, itemCount: normalized.items.length, paymentCount: normalized.payments.length })
  return normalized
}
