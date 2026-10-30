'use client'

import { useState } from 'react'

type Item = { description: string; occurredOn: string; categoryId: string; amountCents: string }
type Props = { invoiceId: string; invoiceTotalCents: string; categories: Array<{ id: string; name: string }>; refresh: () => Promise<unknown> }

const money = (value: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0) / 100)

export function HistoricalImportForm({ invoiceId, invoiceTotalCents, categories, refresh }: Props) {
  const [items, setItems] = useState<Item[]>([{ description: '', occurredOn: '', categoryId: '', amountCents: '' }])
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const total = items.reduce((sum, item) => sum + Number(item.amountCents || 0), 0)
  const update = (index: number, field: keyof Item, value: string) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('')
    if (total !== Number(invoiceTotalCents)) { setError(`A soma deve ser ${money(invoiceTotalCents)} antes de concluir.`); return }
    try {
      const response = await fetch('/api/finance', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'invoices', action: 'historical-import', data: { invoiceId, items, operationKey: crypto.randomUUID() } }) })
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error ?? 'Não foi possível importar a fatura.')
      setDone(true); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível importar a fatura.') }
  }
  return <article className="panel form-panel"><div className="panel-heading"><div><p className="eyebrow">Importação histórica</p><h2>Conferir fatura fechada</h2><p>Os itens viram despesas com auditoria própria. O cabeçalho, vencimento, status, pagamentos e total da fatura não são alterados.</p></div></div>{done ? <p className="success-message">Importação concluída e persistida. Os itens agora aparecem na fatura e no histórico.</p> : <form onSubmit={submit}>{items.map((item, index) => <div className="field-row" key={index}><input aria-label={`Descrição do item ${index + 1}`} required placeholder="Descrição" value={item.description} onChange={(event) => update(index, 'description', event.target.value)} /><input aria-label={`Data do item ${index + 1}`} required type="date" value={item.occurredOn} onChange={(event) => update(index, 'occurredOn', event.target.value)} /><select aria-label={`Categoria do item ${index + 1}`} required value={item.categoryId} onChange={(event) => update(index, 'categoryId', event.target.value)}><option value="">Categoria</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><input aria-label={`Valor do item ${index + 1}`} required inputMode="decimal" placeholder="0,00" value={item.amountCents} onChange={(event) => update(index, 'amountCents', event.target.value.replace(',', '.'))} /></div>)}<div className="form-actions"><button className="outline-button" type="button" onClick={() => setItems((current) => [...current, { description: '', occurredOn: '', categoryId: '', amountCents: '' }])}>Adicionar item</button><strong>Total informado: {money(String(total))} / {money(invoiceTotalCents)}</strong></div>{error && <p className="auth-error">{error}</p>}<button className="primary-button" type="submit">Importar compras históricas</button></form>}</article>
}
