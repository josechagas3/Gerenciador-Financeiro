'use client'

import { useState } from 'react'
import { formatMoneyCents, formatMoneyInput, parseMoneyCents, sanitizeMoneyInput } from '@/lib/finance/domain'
import { InvoicePdfImport, type InvoicePdfImportData } from './invoice-pdf-import'

type Card = { id: string; name: string; brand: string; availableCents: string }
type Invoice = { id: string; status: string; totalCents: string }
type Props = { cards: Card[]; invoices: Invoice[]; refresh: () => Promise<unknown>; onCreated?: (invoiceId: string, imported: InvoicePdfImportData) => void }

const money = (value: string) => { try { return formatMoneyCents(parseMoneyCents(value)) } catch { return 'R$ 0,00' } }

export function InvoiceAvailabilityNotice({ cards, invoices, refresh, onCreated }: Props) {
  const [cardId, setCardId] = useState(cards[0]?.id ?? '')
  const [periodReference, setPeriodReference] = useState(''); const [closingDate, setClosingDate] = useState(''); const [dueOn, setDueOn] = useState(''); const [totalCents, setTotalCents] = useState(''); const [paidCents, setPaidCents] = useState(''); const [error, setError] = useState(''); const [done, setDone] = useState(false)
  const [imported, setImported] = useState<InvoicePdfImportData | null>(null)
  const applyPdf = (value: InvoicePdfImportData) => { setImported(value); if (value.dueDate) { setDueOn(value.dueDate); setPeriodReference(value.dueDate.slice(0, 7)) } else if (value.closingDate) setPeriodReference(value.closingDate.slice(0, 7)); if (value.closingDate) setClosingDate(value.closingDate); if (value.totalAmount) setTotalCents(sanitizeMoneyInput(value.totalAmount)); setPaidCents(''); }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('')
    try {
      const total = parseMoneyCents(totalCents)
      const paid = parseMoneyCents(paidCents || '0')
      if (total <= 0n) throw new Error('O valor original deve ser maior que zero.')
      if (paid < 0n || paid > total) throw new Error('O valor pago deve ser maior ou igual a zero e não pode superar o total.')
      const response = await fetch('/api/finance', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'invoices', action: 'create-existing', data: { cardId, periodStart: closingDate ? `${closingDate.slice(0, 7)}-01` : periodReference ? `${periodReference}-01` : '', periodEnd: closingDate, dueOn, totalCents, historicalPaidCents: paidCents || '0', operationKey: crypto.randomUUID() } }) })
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error ?? 'Não foi possível cadastrar a fatura.')
      const rawResult = result.result; const createdId = typeof rawResult === 'string' ? rawResult : Array.isArray(rawResult) ? rawResult[0]?.id : rawResult && typeof rawResult === 'object' && rawResult !== null && 'id' in rawResult && typeof rawResult.id === 'string' ? rawResult.id : ''; setDone(true); if (createdId && imported) onCreated?.(createdId, imported); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível cadastrar a fatura.') }
  }
  return <article className="panel form-panel invoice-entry-panel"><div className="panel-heading"><div><p className="eyebrow">Nova fatura existente</p><h2>Cadastrar fatura real fechada</h2><p>Cadastre somente o cabeçalho real. Nenhuma despesa, pagamento ou lançamento artificial será criado.</p>{imported && <small className="import-ready-note">Dados do PDF carregados para revisão. Confirme os campos antes de cadastrar.</small>}</div><InvoicePdfImport onApply={applyPdf} /></div>{done ? <p className="success-message">Fatura cadastrada. Agora importe as compras reais até a soma fechar exatamente o total original.</p> : <form onSubmit={submit}><label className="form-field"><span>Cartão</span><select required value={cardId} onChange={(event) => setCardId(event.target.value)}><option value="">Selecione o cartão</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.name} · {card.brand}</option>)}</select></label><div className="field-row"><label className="form-field"><span>Período de referência</span><input required type="month" value={periodReference} onChange={(event) => setPeriodReference(event.target.value)} /></label><label className="form-field"><span>Data de fechamento</span><input required type="date" value={closingDate} onChange={(event) => setClosingDate(event.target.value)} /></label></div><div className="field-row"><label className="form-field"><span>Status inicial</span><input value="Fechada" readOnly /></label><label className="form-field"><span>Vencimento</span><input required type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} /></label></div><div className="field-row"><label className="form-field"><span>Total original</span><input required inputMode="decimal" placeholder="0,00" value={totalCents} onChange={(event) => setTotalCents(sanitizeMoneyInput(event.target.value))} onBlur={() => { if (totalCents) { try { setTotalCents(formatMoneyInput(totalCents)) } catch {} } }} /></label><label className="form-field"><span>Valor já pago</span><input inputMode="decimal" placeholder="0,00" value={paidCents} onChange={(event) => setPaidCents(sanitizeMoneyInput(event.target.value))} onBlur={() => { if (paidCents) { try { setPaidCents(formatMoneyInput(paidCents)) } catch {} } }} /></label></div><p className="form-hint">Status inicial: fechada. Total: {money(totalCents)} · Pago: {money(paidCents || '0')}</p>{error && <p className="auth-error">{error}</p>}<button className="primary-button" type="submit">Cadastrar fatura existente</button></form>}</article>
}
