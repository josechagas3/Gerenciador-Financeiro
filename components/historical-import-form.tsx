'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatMoneyCents, formatMoneyInput, parseMoneyCents, sanitizeMoneyInput } from '@/lib/finance/domain'
import { InvoicePdfImport, type InvoicePdfImportData } from './invoice-pdf-import'

type ItemKind = 'purchase' | 'credit' | 'refund' | 'interest' | 'iof' | 'annual_fee' | 'fee' | 'other_charge' | 'needs_review' | 'invoice_installment'
type Item = { kind: ItemKind; description: string; cardIdentifier: string | null; occurredOn: string; categoryId: string; amountCents: string; installmentCurrent: string; installmentCount: string }
type Payment = { transactionId: string; paidAt: string; amountCents: string; description: string }
type PaymentCandidate = { id: string; description: string; effectiveOn: string; amountCents: string; accountName: string; categoryName: string }
type Props = { invoiceId: string; invoiceTotalCents: string; paidCents: string; categories: Array<{ id: string; name: string }>; transactions: PaymentCandidate[]; refresh: () => Promise<unknown>; pendingImport?: InvoicePdfImportData | null }

const kinds: Array<{ value: ItemKind; label: string; sign: 'plus' | 'minus' }> = [
  { value: 'purchase', label: 'Compra', sign: 'plus' },
  { value: 'credit', label: 'Crédito', sign: 'minus' },
  { value: 'refund', label: 'Estorno', sign: 'minus' },
  { value: 'interest', label: 'Juros', sign: 'plus' },
  { value: 'iof', label: 'IOF', sign: 'plus' },
  { value: 'annual_fee', label: 'Anuidade', sign: 'plus' },
  { value: 'fee', label: 'Tarifa', sign: 'plus' },
  { value: 'other_charge', label: 'Outro encargo', sign: 'plus' },
  { value: 'needs_review', label: 'Revisar: possível fatura/parcelamento', sign: 'plus' },
  { value: 'invoice_installment', label: 'Parcelamento de fatura', sign: 'plus' },
]
const blankItem = (): Item => ({ kind: 'purchase', description: '', cardIdentifier: null, occurredOn: '', categoryId: '', amountCents: '', installmentCurrent: '', installmentCount: '' })
const blankPayment = (): Payment => ({ transactionId: '', paidAt: '', amountCents: '', description: '' })
const money = (cents: bigint) => formatMoneyCents(cents)
const absoluteMoneyCents = (value: string) => { const cents = parseMoneyCents(value || '0'); return cents < 0n ? -cents : cents }

export function HistoricalImportForm({ invoiceId, invoiceTotalCents, paidCents, categories, transactions, refresh, pendingImport }: Props) {
  const [openingBalance, setOpeningBalance] = useState(pendingImport?.openingBalance || '')
  const [items, setItems] = useState<Item[]>(pendingImport?.items.map((item) => ({ kind: item.kind, description: item.description, cardIdentifier: item.cardIdentifier || null, occurredOn: item.occurredOn || '', categoryId: '', amountCents: item.amount, installmentCurrent: item.installmentCurrent == null ? '' : String(item.installmentCurrent), installmentCount: item.installmentTotal == null ? '' : String(item.installmentTotal) })) || [blankItem()])
  const [payments, setPayments] = useState<Payment[]>(pendingImport?.payments.map((payment) => ({ transactionId: '', paidAt: payment.paidAt || '', amountCents: payment.amount, description: payment.description })) || [])
  const [error, setError] = useState('')
  const invalidInstallmentItems = items.filter((item) => {
    if (item.kind === 'invoice_installment') return !Number.isInteger(Number(item.installmentCurrent)) || Number(item.installmentCurrent) < 1 || !Number.isInteger(Number(item.installmentCount)) || Number(item.installmentCount) < Number(item.installmentCurrent)
    if (item.kind !== 'purchase') return false
    const countRaw = item.installmentCount.trim()
    if (countRaw === '') return false
    const installmentCount = Number(countRaw)
    return !Number.isInteger(Number(item.installmentCurrent)) || Number(item.installmentCurrent) < 1 || !Number.isInteger(installmentCount) || installmentCount < 2 || installmentCount > 120 || Number(item.installmentCurrent) > installmentCount
  })
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!pendingImport) return
    setOpeningBalance(pendingImport.openingBalance || '')
    setItems(pendingImport.items.map((item) => ({ kind: item.kind, description: item.description, cardIdentifier: item.cardIdentifier || null, occurredOn: item.occurredOn || '', categoryId: '', amountCents: item.amount, installmentCurrent: item.installmentCurrent == null ? '' : String(item.installmentCurrent), installmentCount: item.installmentTotal == null ? '' : String(item.installmentTotal) })))
    setPayments(pendingImport.payments.map((payment) => ({ transactionId: '', paidAt: payment.paidAt || '', amountCents: payment.amount, description: payment.description })))
    setDone(false)
  }, [pendingImport, invoiceId])
  const paidCentsValue = BigInt(paidCents || '0')
  const calculatedTotalCents = useMemo(() => {
    let value = 0n
    try { value += absoluteMoneyCents(openingBalance) } catch {}
    for (const item of items) { try { value += ['credit', 'refund'].includes(item.kind) ? -absoluteMoneyCents(item.amountCents) : item.kind === 'needs_review' ? 0n : absoluteMoneyCents(item.amountCents) } catch {} }
    for (const payment of payments) { try { value -= absoluteMoneyCents(payment.amountCents) } catch {} }
    value -= paidCentsValue
    return value
  }, [openingBalance, items, payments, paidCentsValue])
  const invoiceTotalCentsValue = BigInt(invoiceTotalCents)
  const differenceCents = invoiceTotalCentsValue - calculatedTotalCents
  const allPaymentsValid = payments.every((payment) => payment.paidAt && payment.amountCents && payment.description.trim())
  const paymentCandidates = (payment: Payment) => {
    const expectedAmount = absoluteMoneyCents(payment.amountCents)
    return transactions
      .filter((transaction) => transaction.categoryName.toLowerCase() === 'crédito em conta' && transaction.amountCents === expectedAmount.toString())
      .sort((a, b) => Math.abs(Date.parse(a.effectiveOn) - Date.parse(payment.paidAt)) - Math.abs(Date.parse(b.effectiveOn) - Date.parse(payment.paidAt)))
  }
  const updateItem = (index: number, field: keyof Item, value: string) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))
  const updatePayment = (index: number, field: keyof Payment, value: string) => setPayments((current) => current.map((payment, paymentIndex) => paymentIndex === index ? { ...payment, [field]: value } : payment))
  const applyPdf = (value: InvoicePdfImportData) => { setOpeningBalance(value.openingBalance || ''); setItems(value.items.map((item) => ({ kind: item.kind, description: item.description, cardIdentifier: item.cardIdentifier || null, occurredOn: item.occurredOn || '', amountCents: item.amount, installmentCurrent: item.installmentCurrent == null ? '' : String(item.installmentCurrent), installmentCount: item.installmentTotal == null ? '' : String(item.installmentTotal), categoryId: '' }))); setPayments(value.payments.map((payment) => ({ transactionId: '', paidAt: payment.paidAt || '', amountCents: payment.amount, description: payment.description }))); setError(''); }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('')
    if (items.some((item) => item.kind === 'needs_review')) { setError('Revise o lançamento marcado como possível pagamento ou parcelamento de fatura antes de confirmar.'); return }
    if (invalidInstallmentItems.length > 0) { setError(`Revise as parcelas: ${invalidInstallmentItems.map((item) => `${item.description || 'Sem descrição'} (${item.kind}): ${item.installmentCurrent || 'vazio'}/${item.installmentCount || 'vazio'}`).join('; ')}.`); return }
    if (!allPaymentsValid) { setError('Revise data, descrição e valor de cada pagamento antes de confirmar.'); return }
    if (differenceCents !== 0n) { setError(`A conciliação precisa fechar em ${money(invoiceTotalCentsValue)}. Diferença atual: ${money(differenceCents)}.`); return }
    try {
      const response = await fetch('/api/finance', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'invoices', action: 'historical-reconcile', data: { invoiceId, openingBalanceCents: absoluteMoneyCents(openingBalance).toString(), items: items.filter((item) => item.description && item.amountCents).map((item) => ({ ...item, description: item.cardIdentifier ? `[Cartão final ${item.cardIdentifier}] ${item.description}` : item.description, amountCents: absoluteMoneyCents(item.amountCents).toString(), installmentCurrent: item.installmentCurrent.trim() === '' ? undefined : Number(item.installmentCurrent), installmentCount: item.installmentCount.trim() === '' ? undefined : Number(item.installmentCount) })), payments: payments.filter((payment) => payment.amountCents).map((payment) => ({ ...payment, description: payment.description.trim(), sourceType: payment.transactionId ? 'linked_transaction' : 'historical_pdf', amountCents: absoluteMoneyCents(payment.amountCents).toString() })), operationKey: crypto.randomUUID() } }) })
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error ?? 'Não foi possível conciliar a fatura.')
      setDone(true); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível conciliar a fatura.') }
  }
  if (done) return <article className="panel form-panel"><p className="success-message">Conciliação concluída e persistida. Compras, ajustes e pagamentos foram registrados sem duplicidade.</p></article>
  return <article className="panel form-panel"><div className="panel-heading"><div><p className="eyebrow">Conciliação histórica</p><h2>Fechar fatura com segurança</h2><p>Separe compras, créditos, pagamentos e encargos. O pagamento histórico de {money(paidCentsValue)} já está incluído.</p></div><InvoicePdfImport invoiceId={invoiceId} invoiceTotalCents={invoiceTotalCents} paidCents={paidCents} onApply={applyPdf} /></div><form onSubmit={submit}><section><h3>Saldo anterior</h3><input aria-label="Saldo anterior" inputMode="decimal" placeholder="0,00" value={openingBalance} onChange={(event) => setOpeningBalance(sanitizeMoneyInput(event.target.value))} onBlur={() => { if (openingBalance) try { setOpeningBalance(formatMoneyInput(openingBalance)) } catch {} }} /></section><section><h3>Compras, créditos e encargos</h3>{items.map((item, index) => <div className="field-row" key={index}><select aria-label={`Tipo do ajuste ${index + 1}`} value={item.kind} onChange={(event) => updateItem(index, 'kind', event.target.value)}>{kinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select>{item.cardIdentifier && <small className="field-hint">Cartão final {item.cardIdentifier}</small>}<input aria-label={`Descrição do ajuste ${index + 1}`} required placeholder="Descrição" value={item.description} onChange={(event) => updateItem(index, 'description', event.target.value)} /><input aria-label={`Data do ajuste ${index + 1}`} required type="date" value={item.occurredOn} onChange={(event) => updateItem(index, 'occurredOn', event.target.value)} /><input aria-label={`Valor do ajuste ${index + 1}`} required inputMode="decimal" placeholder="0,00" value={item.amountCents} onChange={(event) => updateItem(index, 'amountCents', sanitizeMoneyInput(event.target.value))} onBlur={() => { try { updateItem(index, 'amountCents', formatMoneyInput(item.amountCents)) } catch {} }} />{['purchase', 'invoice_installment'].includes(item.kind) && <><select aria-label={`Categoria da compra ${index + 1}`} required value={item.categoryId} onChange={(event) => updateItem(index, 'categoryId', event.target.value)}><option value="">Categoria</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><input aria-label={`Parcela atual da compra ${index + 1}`} type="number" min="1" max="120" value={item.installmentCurrent} onChange={(event) => updateItem(index, 'installmentCurrent', event.target.value)} /><input aria-label={`Total de parcelas da compra ${index + 1}`} type="number" min="1" max="120" value={item.installmentCount} onChange={(event) => updateItem(index, 'installmentCount', event.target.value)} />{(item.kind === 'invoice_installment' || Number(item.installmentCount) > 1) && <span className="muted-text">Parcela {item.installmentCurrent}/{item.installmentCount}</span>}</>}<button className="outline-button" type="button" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remover</button></div>)}<button className="outline-button" type="button" onClick={() => setItems((current) => [...current, blankItem()])}>Adicionar item</button></section><section><h3>Pagamentos adicionais</h3>{payments.map((payment, index) => <div className="field-row" key={index}><input aria-label={`Descrição do pagamento ${index + 1}`} required placeholder="Descrição do pagamento" value={payment.description} onChange={(event) => updatePayment(index, 'description', event.target.value)} /><select aria-label={`Origem do pagamento ${index + 1}`} value={payment.transactionId} onChange={(event) => updatePayment(index, 'transactionId', event.target.value)}><option value="">Pagamento histórico importado do PDF</option>{paymentCandidates(payment).map((transaction) => <option key={transaction.id} value={transaction.id}>{transaction.effectiveOn} · {transaction.accountName} · {transaction.description} · {money(BigInt(transaction.amountCents))}</option>)}</select><input aria-label={`Data do pagamento ${index + 1}`} required type="date" value={payment.paidAt} onChange={(event) => updatePayment(index, 'paidAt', event.target.value)} /><input aria-label={`Valor do pagamento ${index + 1}`} required inputMode="decimal" placeholder="0,00" value={payment.amountCents} onChange={(event) => updatePayment(index, 'amountCents', sanitizeMoneyInput(event.target.value))} /><button className="outline-button" type="button" onClick={() => setPayments((current) => current.filter((_, paymentIndex) => paymentIndex !== index))}>Remover</button></div>)}<button className="outline-button" type="button" onClick={() => setPayments((current) => [...current, blankPayment()])}>Adicionar pagamento</button></section><div className="form-actions"><strong>Calculado: {money(calculatedTotalCents)}</strong><strong>Fatura: {money(invoiceTotalCentsValue)}</strong><strong>Diferença: {money(differenceCents)}</strong></div>{error && <p className="auth-error">{error}</p>}<button className="primary-button" type="submit" disabled={differenceCents !== 0n || !allPaymentsValid}>Confirmar conciliação</button></form></article>
}
