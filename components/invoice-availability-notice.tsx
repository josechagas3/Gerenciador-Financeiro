'use client'

import { useState } from 'react'

type Card = { id: string; name: string; brand: string; availableCents: string }
type Invoice = { id: string; status: string; totalCents: string }
type Props = { cards: Card[]; invoices: Invoice[]; refresh: () => Promise<unknown> }

const money = (value: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0) / 100)

export function InvoiceAvailabilityNotice({ cards, invoices, refresh }: Props) {
  const [cardId, setCardId] = useState(cards[0]?.id ?? '')
  const [periodReference, setPeriodReference] = useState(''); const [closingDate, setClosingDate] = useState(''); const [dueOn, setDueOn] = useState(''); const [totalCents, setTotalCents] = useState(''); const [paidCents, setPaidCents] = useState(''); const [error, setError] = useState(''); const [done, setDone] = useState(false)
  if (invoices.length > 0) return null
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('')
    try {
      const response = await fetch('/api/finance', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'invoices', action: 'create-existing', data: { cardId, periodStart: periodReference ? `${periodReference}-01` : '', periodEnd: closingDate, dueOn, totalCents, historicalPaidCents: paidCents || '0', operationKey: crypto.randomUUID() } }) })
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error ?? 'Não foi possível cadastrar a fatura.')
      setDone(true); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível cadastrar a fatura.') }
  }
  return <article className="panel form-panel invoice-entry-panel"><div className="panel-heading"><div><p className="eyebrow">Cadastrar fatura existente</p><h2>Fatura real fechada</h2><p>Cadastre somente o cabeçalho real. Nenhuma despesa, pagamento ou lançamento artificial será criado.</p></div></div>{done ? <p className="success-message">Fatura cadastrada. Agora importe as compras reais até a soma fechar exatamente o total original.</p> : <form onSubmit={submit}><label className="form-field"><span>Cartão</span><select required value={cardId} onChange={(event) => setCardId(event.target.value)}><option value="">Selecione o cartão</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.name} · {card.brand}</option>)}</select></label><div className="field-row"><label className="form-field"><span>Período de referência</span><input required type="month" value={periodReference} onChange={(event) => setPeriodReference(event.target.value)} /></label><label className="form-field"><span>Data de fechamento</span><input required type="date" value={closingDate} onChange={(event) => setClosingDate(event.target.value)} /></label></div><div className="field-row"><label className="form-field"><span>Status inicial</span><input value="Fechada" readOnly /></label><label className="form-field"><span>Vencimento</span><input required type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} /></label></div><div className="field-row"><label className="form-field"><span>Total original</span><input required inputMode="decimal" placeholder="0,00" value={totalCents} onChange={(event) => setTotalCents(event.target.value.replace(',', '.'))} /></label><label className="form-field"><span>Valor já pago</span><input inputMode="decimal" placeholder="0,00" value={paidCents} onChange={(event) => setPaidCents(event.target.value.replace(',', '.'))} /></label></div><p className="form-hint">Status inicial: fechada. Total: {money(totalCents)} · Pago: {money(paidCents || '0')}</p>{error && <p className="auth-error">{error}</p>}<button className="primary-button" type="submit">Cadastrar fatura existente</button></form>}</article>
}
