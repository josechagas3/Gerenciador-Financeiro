import { generateText, Output } from 'ai'
import { z } from 'zod'

const extractedItem = z.object({
  kind: z.enum(['purchase', 'credit', 'refund', 'interest', 'iof', 'annual_fee', 'fee', 'other_charge']),
  description: z.string().min(1).max(180),
  occurredOn: z.string().nullable(),
  amount: z.string().describe('Valor decimal brasileiro sem símbolo, por exemplo 1234,56'),
  installmentCurrent: z.number().int().positive().nullable(),
  installmentTotal: z.number().int().positive().nullable(),
  confidence: z.number().min(0).max(1),
})

const invoiceExtractionSchema = z.object({
  bankName: z.string().nullable(),
  cardIdentifier: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  closingDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  totalAmount: z.string().nullable(),
  openingBalance: z.string().nullable(),
  items: z.array(extractedItem).max(500),
  payments: z.array(z.object({ description: z.string(), paidAt: z.string().nullable(), amount: z.string(), confidence: z.number().min(0).max(1) })).max(50),
  warnings: z.array(z.string().max(300)).max(30),
})

export type InvoicePdfExtraction = z.infer<typeof invoiceExtractionSchema>

export async function extractInvoicePdf(file: Uint8Array, filename: string): Promise<InvoicePdfExtraction> {
  const result = await generateText({
    model: 'google/gemini-2.5-flash',
    output: Output.object({ name: 'CardInvoiceExtraction', schema: invoiceExtractionSchema }),
    maxOutputTokens: 12000,
    temperature: 0,
    instructions: 'Você extrai dados de faturas brasileiras. Nunca invente valores. Use null quando algo não estiver legível. Datas devem estar em YYYY-MM-DD. Separe pagamentos de compras: pagamentos nunca são itens de despesa. Para valores use vírgula decimal sem símbolo. Preserve sinais sem transformar créditos/estornos em receitas. Priorize o layout Sicredi, mas aceite outros layouts. Inclua avisos para qualquer ambiguidade, OCR ruim, campo ausente ou divergência aparente.',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `Leia o PDF ${filename} e extraia a fatura inteira para revisão humana. Identifique compras parceladas, encargos, créditos, estornos e pagamentos separadamente. Não execute nenhuma conciliação.` },
        { type: 'file', data: file, mediaType: 'application/pdf', filename },
      ],
    }],
  })
  if (!result.output) throw new Error('Não foi possível extrair dados estruturados do PDF.')
  return result.output
}
