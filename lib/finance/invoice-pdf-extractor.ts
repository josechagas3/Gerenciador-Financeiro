import { generateText, Output } from 'ai'
import { z } from 'zod'

const itemKind = z.enum(['purchase', 'credit', 'refund', 'interest', 'iof', 'annual_fee', 'fee', 'other_charge'])

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
    instructions: 'Você extrai dados de faturas brasileiras. Nunca invente valores. Use null quando algo não estiver legível. Datas devem estar em YYYY-MM-DD. Separe pagamentos de compras: pagamentos nunca são itens de despesa. Para valores use vírgula decimal sem símbolo. Identifique o cartão de origem em cada item quando o PDF informar o final; cartões físico e virtual pertencem à mesma fatura. Preserve sinais sem transformar créditos/estornos em receitas. No layout Sicredi, extraia separadamente todas as linhas de crédito e estorno: Estorno CTK Marília (R$ 36,79), Crédito de anuidade (R$ 11,67), Ajuste a crédito de IOF (R$ 0,06) e Ajuste a crédito de IOF (R$ 0,18). Classifique essas quatro linhas como `credit` ou `refund`, nunca como pagamento, compra, encargo ou parte de `Cred P Fat Ent`; não as agrupe nem as descarte. Preserve cada ocorrência mesmo quando a descrição se repetir. Priorize o layout Sicredi, mas aceite outros layouts. Inclua avisos para qualquer ambiguidade, OCR ruim, campo ausente ou divergência aparente.',
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
  console.info('[v0] Importação PDF validada', { stage: 'schema-validation', validationCompleted: true, partialResponse: false, itemCount: validated.data.items.length, paymentCount: validated.data.payments.length })
  return validated.data
}
