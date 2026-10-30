'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatMoneyCents, formatMoneyInput, parseMoneyCents, sanitizeMoneyInput } from '@/lib/finance/domain'
import { InvoicePdfImport, type InvoicePdfImportData } from './invoice-pdf-import'

type ItemKind = 'purchase' | 'credit' | 'refund' | 'interest' | 'iof' | 'annual_fee' | 'fee' | 'other_charge'
type Item = { kind: ItemKind; description: string; cardIdentifier: string | null; occurredOn: string; categoryId: string; amountCents: string; installmentCount: string }
type Payment = { transactionId: string; paidAt: string; amountCents: string }
type Props = { invoiceId: string; invoiceTotalCents: string; paidCents: string; categories: Array<{ id: string; name: string }>; transactions: Array<{ id: string; description: string; effectiveOn: string }>; refresh: () => Promise<unknown>; pendingImport?: InvoicePdfImportData | null }

const kinds: Array<{ value: ItemKind; label: string; sign: 'plus' | 'minus' }> = [
  { value: 'purchase', label: 'Compra', sign: 'plus' },
  { value: 'credit', label: 'Crédito', sign: 'minus' },
  { value: 'refund', label: 'Estorno', sign: 'minus' },
  { value: 'interest', label: 'Juros', sign: 'plus' },
  { value: 'iof', label: 'IOF', sign: 'plus' },
  { value: 'annual_fee', label: 'Anuidade', sign: 'plus' },
  { value: 'fee', label: 'Tarifa', sign: 'plus' },
  { value: 'other_charge', label: 'Outro encargo', sign: 'plus' },
]
const blankItem = (): Item => ({ kind: 'purchase', description: '', cardIdentifier: null, occurredOn: '', categoryId: '', amountCents: '', installmentCount: '1' })
const blankPayment = (): Payment => ({ transactionId: '', paidAt: '', amountCents: '' })
const money = (cents: bigint) => formatMoneyCents(cents)
const absoluteMoneyCents = (value: string) => { const cents = parseMoneyCents(value || '0'); return cents < 0n ? -cents : cents }

export function HistoricalImportForm({ invoiceId, invoiceTotalCents, paidCents, categories, transactions, refresh, pendingImport }: Props) {
  const [openingBalance, setOpeningBalance] = useState(pendingImport?.openingBalance || '')
  const [items, setItems] = useState<Item[]>(pendingImport?.items.map((item) => ({ kind: item.kind, description: item.description, cardIdentifier: item.cardIdentifier || null, occurredOn: item.occurredOn || '', categoryId: '', amountCents: item.amount, installmentCount: String(item.installmentTotal || 1) })) || [blankItem()])
  const [payments, setPayments] = useState<Payment[]>(pendingImport?.payments.map((payment) => ({ transactionId: '', paidAt: payment.paidAt || '', amountCents: payment.amount })) || [])
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!pendingImport) return
    setOpeningBalance(pendingImport.openingBalance || '')
    setItems(pendingImport.items.map((item) => ({ kind: item.kind, description: item.description, cardIdentifier: item.cardIdentifier || null, occurredOn: item.occurredOn || '', categoryId: '', amountCents: item.amount, installmentCount: String(item.installmentTotal || 1) })))
    setPayments(pendingImport.payments.map((payment) => ({ transactionId: '', paidAt: payment.paidAt || '', amountCents: payment.amount })))
    setDone(false)
  }, [pendingImport, invoiceId])
  const total = useMemo(() => {
    let value = 0n
    try { value += absoluteMoneyCents(openingBalance) } catch {}
    for (const item of items) { try { value += ['credit', 'refund'].includes(item.kind) ? -absoluteMoneyCents(item.amountCents) : absoluteMoneyCents(item.amountCents) } catch {} }
    for (const payment of payments) { try { value -= absoluteMoneyCents(payment.amountCents) } catch {} }
    try { value -= BigInt(paidCents) } catch {}
    return value
  }, [openingBalance, items, payments, paidCents])
  const invoiceTotal = BigInt(invoiceTotalCents)
  const difference = invoiceTotal - total
  const updateItem = (index: number, field: keyof Item, value: string) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))
  const updatePayment = (index: number, field: keyof Payment, value: string) => setPayments((current) => current.map((payment, paymentIndex) => paymentIndex === index ? { ...payment, [field]: value } : payment))
  const applyPdf = (value: InvoicePdfImportData) => { setOpeningBalance(value.openingBalance || ''); setItems(value.items.map((item) => ({ kind: item.kind, description: item.description, cardIdentifier: item.cardIdentifier || null, occurredOn: item.occurredOn || '', amountCents: item.amount, installmentCount: String(item.installmentTotal || 1), categoryId: '' }))); setPayments(value.payments.map((payment) => ({ transactionId: '', paidAt: payment.paidAt || '', amountCents: payment.amount }))); setError(''); }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('')
    if (difference !== 0n) { setError(`A conciliação precisa fechar em ${money(invoiceTotal)}. Diferença atual: ${money(difference)}.`); return }
    try {
      const response = await fetch('/api/finance', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'invoices', action: 'historical-reconcile', data: { invoiceId, openingBalanceCents: absoluteMoneyCents(openingBalance).toString(), items: items.filter((item) => item.description && item.amountCents).map((item) => ({ ...item, description: item.cardIdentifier ? `[Cartão final ${item.cardIdentifier}] ${item.description}` : item.description, amountCents: absoluteMoneyCents(item.amountCents).toString(), installmentCount: Number(item.installmentCount || 1) })), payments: payments.filter((payment) => payment.transactionId && payment.amountCents).map((payment) => ({ ...payment, amountCents: absoluteMoneyCents(payment.amountCents).toString() })), operationKey: crypto.randomUUID() } }) })
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error ?? 'Não foi possível conciliar a fatura.')
      setDone(true); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível conciliar a fatura.') }
  }
  if (done) return <article className="panel form-panel"><p className="success-message">Conciliação concluída e persistida. Compras, ajustes e pagamentos foram registrados sem duplicidade.</p></article>
  return <article className="panel form-panel"><div className="panel-heading"><div><p className="eyebrow">Conciliação histórica</p><h2>Fechar fatura com segurança</h2><p>Separe compras, créditos, pagamentos e encargos. O pagamento histórico de {money(BigInt(paidCents))} já está incluído.</p></div><InvoicePdfImport invoiceId={invoiceId} invoiceTotalCents={invoiceTotalCents} paidCents={paidCents} onApply={applyPdf} /></div><form onSubmit={submit}><section><h3>Saldo anterior</h3><input aria-label="Saldo anterior" inputMode="decimal" placeholder="0,00" value={openingBalance} onChange={(event) => setOpeningBalance(sanitizeMoneyInput(event.target.value))} onBlur={() => { if (openingBalance) try { setOpeningBalance(formatMoneyInput(openingBalance)) } catch {} }} /></section><section><h3>Compras, créditos e encargos</h3>{items.map((item, index) => <div className="field-row" key={index}><select aria-label={`Tipo do ajuste ${index + 1}`} value={item.kind} onChange={(event) => updateItem(index, 'kind', event.target.value)}>{kinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select>{item.cardIdentifier && <small className="field-hint">Cartão final {item.cardIdentifier}</small>}<input aria-label={`Descrição do ajuste ${index + 1}`} required placeholder="Descrição" value={item.description} onChange={(event) => updateItem(index, 'description', event.target.value)} /><input aria-label={`Data do ajuste ${index + 1}`} required type="date" value={item.occurredOn} onChange={(event) => updateItem(index, 'occurredOn', event.target.value)} /><input aria-label={`Valor do ajuste ${index + 1}`} required inputMode="decimal" placeholder="0,00" value={item.amountCents} onChange={(event) => updateItem(index, 'amountCents', sanitizeMoneyInput(event.target.value))} onBlur={() => { try { updateItem(index, 'amountCents', formatMoneyInput(item.amountCents)) } catch {} }} />{item.kind === 'purchase' && <><select aria-label={`Categoria da compra ${index + 1}`} required value={item.categoryId} onChange={(event) => updateItem(index, 'categoryId', event.target.value)}><option value="">Categoria</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><input aria-label={`Parcelas da compra ${index + 1}`} type="number" min="1" max="120" value={item.installmentCount} onChange={(event) => updateItem(index, 'installmentCount', event.target.value)} /></>}<button className="outline-button" type="button" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remover</button></div>)}<button className="outline-button" type="button" onClick={() => setItems((current) => [...current, blankItem()])}>Adicionar item</button></section><section><h3>Pagamentos adicionais</h3>{payments.map((payment, index) => <div className="field-row" key={index}><select aria-label={`Transferência do pagamento ${index + 1}`} required value={payment.transactionId} onChange={(event) => updatePayment(index, 'transactionId', event.target.value)}><option value="">Transferência publicada</option>{transactions.map((transaction) => <option key={transaction.id} value={transaction.id}>{transaction.description} · {transaction.effectiveOn}</option>)}</select><input aria-label={`Data do pagamento ${index + 1}`} required type="date" value={payment.paidAt} onChange={(event) => updatePayment(index, 'paidAt', event.target.value)} /><input aria-label={`Valor do pagamento ${index + 1}`} required inputMode="decimal" placeholder="0,00" value={payment.amountCents} onChange={(event) => updatePayment(index, 'amountCents', sanitizeMoneyInput(event.target.value))} /><button className="outline-button" type="button" onClick={() => setPayments((current) => current.filter((_, paymentIndex) => paymentIndex !== index))}>Remover</button></div>)}<button className="outline-button" type="button" onClick={() => setPayments((current) => [...current, blankPayment()])}>Adicionar pagamento</button></section><div className="form-actions"><strong>Calculado: {money(total)}</strong><strong>Fatura: {money(invoiceTotal)}</strong><strong>Diferença: {money(difference)}</strong></div>{error && <p className="auth-error">{error}</p>}<button className="primary-button" type="submit" disabled={difference !== 0n}>Confirmar conciliação</button></form></article>
}
