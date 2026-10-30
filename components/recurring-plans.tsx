'use client'

import { useMemo, useState } from 'react'
import { CalendarClock, CheckCircle2, CircleDollarSign, FileWarning, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { formatMoneyCents, formatMoneyInput, parseMoneyCents, sanitizeMoneyInput } from '@/lib/finance/domain'

type Account = { id: string; name: string; type: string; currency: string; isActive: boolean }
type Category = { id: string; name: string; parentId: string | null; kind: 'income' | 'expense' | 'both'; isActive: boolean }
type PlannedItem = {
  id: string
  description: string
  type: 'income' | 'expense'
  amount: string
  categoryId: string
  dueOn: string
  frequency: 'monthly' | 'unknown'
  status: 'planned' | 'realized' | 'cancelled'
  realizedOn?: string
}

type Props = { accounts: Account[]; categories: Category[]; refresh: () => Promise<unknown> }

const initialMonth = '2026-11'
const api = async (body: Record<string, unknown>) => {
  const response = await fetch('/api/finance', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? 'Não foi possível efetivar a previsão.')
  return result
}
const formatMoney = (amount: string) => { try { return formatMoneyCents(parseMoneyCents(amount)) } catch { return 'Valor pendente' } }
const today = () => new Date().toISOString().slice(0, 10)

export function RecurringPlans({ accounts, categories, refresh }: Props) {
  const [month, setMonth] = useState(initialMonth)
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | PlannedItem['status']>('all')
  const [items, setItems] = useState<PlannedItem[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ description: '', type: 'expense' as PlannedItem['type'], amount: '', categoryId: '', dueOn: '', frequency: 'monthly' as PlannedItem['frequency'] })

  const filtered = useMemo(() => items.filter((item) => item.dueOn.startsWith(month) && (typeFilter === 'all' || item.type === typeFilter) && (statusFilter === 'all' || item.status === statusFilter)), [items, month, statusFilter, typeFilter])
  const totals = useMemo(() => filtered.reduce((result, item) => {
    let value = 0n
    try { value = parseMoneyCents(item.amount) } catch {}
    if (item.status === 'realized') result.realized += value
    else if (item.status === 'planned') result.pending += value
    if (item.type === 'income') result.income += value
    else result.expense += value
    return result
  }, { income: 0n, expense: 0n, pending: 0n, realized: 0n }), [filtered])
  const availableCategories = categories.filter((category) => category.kind === 'both' || category.kind === form.type)

  const resetForm = () => { setForm({ description: '', type: 'expense', amount: '', categoryId: '', dueOn: '', frequency: 'monthly' }); setEditingId(null) }
  const save = (event: React.FormEvent) => {
    event.preventDefault(); setError('')
    if (!form.dueOn || !form.amount || !form.categoryId) { setError('Informe valor, categoria e vencimento para criar a previsão.'); return }
    try { if (parseMoneyCents(form.amount) <= 0n) throw new Error('O valor deve ser maior que zero.') } catch { setError('Informe um valor monetário válido, como 100,00 ou 1.526,28.'); return }
    if (editingId) setItems((current) => current.map((item) => item.id === editingId && item.status === 'planned' ? { ...item, ...form } : item))
    else setItems((current) => [...current, { ...form, id: crypto.randomUUID(), status: 'planned' }])
    resetForm()
  }
  const realize = async (item: PlannedItem) => {
    const accountId = accounts[0]?.id
    if (!accountId) { setError('Cadastre uma conta antes de confirmar uma previsão.'); return }
    setError('')
    try {
      await api({ resource: 'transactions', action: 'create', data: { accountId, categoryId: item.categoryId, type: item.type, amountCents: item.amount, effectiveOn: today(), description: `[PREVISÃO] ${item.description}`, idempotencyKey: `planned:${item.id}:${item.dueOn}` } })
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'realized', realizedOn: today() } : entry))
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar a previsão.') }
  }
  const cancel = (id: string) => setItems((current) => current.map((item) => item.id === id ? { ...item, status: 'cancelled' } : item))
  const edit = (item: PlannedItem) => { if (item.status !== 'planned') return; setEditingId(item.id); setForm({ description: item.description, type: item.type, amount: item.amount, categoryId: item.categoryId, dueOn: item.dueOn, frequency: item.frequency }) }

  return <section className="planning-layout">
    <div className="planning-main">
      <article className="panel planning-header-panel"><div><p className="eyebrow">Planejamento mensal</p><h2>Receitas e despesas previstas</h2><p className="planning-help">Previsões não alteram o saldo. A movimentação só é criada quando você confirmar o recebimento ou pagamento.</p></div><CalendarClock className="planning-header-icon" size={28} /></article>
      <div className="planning-toolbar"><label className="planning-filter">Mês<input type="month" value={month} min="2026-11" onChange={(event) => setMonth(event.target.value)} /></label><label className="planning-filter">Tipo<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}><option value="all">Todos</option><option value="income">Receitas</option><option value="expense">Despesas</option></select></label><label className="planning-filter">Situação<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">Todas</option><option value="planned">Previstas</option><option value="realized">Realizadas</option><option value="cancelled">Canceladas</option></select></label></div>
      <div className="planning-summary"><div><span>Receitas previstas</span><strong className="positive">{formatMoneyCents(totals.income)}</strong></div><div><span>Despesas previstas</span><strong className="negative">{formatMoneyCents(totals.expense)}</strong></div><div><span>Pendente</span><strong>{formatMoneyCents(totals.pending)}</strong></div><div><span>Realizado</span><strong>{formatMoneyCents(totals.realized)}</strong></div></div>
      {filtered.length ? <div className="planned-list">{filtered.map((item) => <article className="planned-row" key={item.id}><span className={`planned-icon ${item.type}`}><CircleDollarSign size={17} /></span><div className="planned-details"><strong>{item.description || 'Sem descrição'}</strong><small>{item.dueOn} · {item.frequency === 'monthly' ? 'Mensal' : 'Frequência pendente'} · {categories.find((category) => category.id === item.categoryId)?.name ?? 'Categoria pendente'}</small></div><b className={item.type === 'income' ? 'positive' : 'negative'}>{item.type === 'income' ? '+' : '-'} {formatMoney(item.amount)}</b><span className={`planned-status ${item.status}`}>{item.status === 'planned' ? 'Prevista' : item.status === 'realized' ? 'Realizada' : 'Cancelada'}</span><div className="planned-actions">{item.status === 'planned' && <><button className="small-button" onClick={() => edit(item)} aria-label={`Editar ${item.description}`}><Pencil size={14} /></button><button className="small-button" onClick={() => realize(item)}>Confirmar</button><button className="small-button danger" onClick={() => cancel(item.id)} aria-label={`Cancelar ${item.description}`}><Trash2 size={14} /></button></>}</div></article>)}</div> : <div className="panel planning-empty"><FileWarning size={22} /><strong>Nenhuma previsão cadastrada para este período</strong><span>A planilha fornecida não contém linhas de dados. Os itens fixos TDS, HOS, aluguel, internet, seguro, plano e Theo aguardam confirmação de valor e data.</span></div>}
      {error && <p className="auth-error planning-error">{error}</p>}
    </div>
    <article className="panel planning-form-panel"><div className="panel-heading"><div><h2>{editingId ? 'Editar previsão' : 'Nova previsão'}</h2><p>Rascunho local até a efetivação.</p></div><RotateCcw size={17} className="panel-heading-icon" /></div><form onSubmit={save} className="planning-form"><label className="form-field"><span>Descrição</span><input required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Ex.: Aluguel" /></label><label className="form-field"><span>Tipo</span><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as PlannedItem['type'], categoryId: '' })}><option value="expense">Despesa</option><option value="income">Receita</option></select></label><label className="form-field"><span>Valor previsto</span><input required value={form.amount} onChange={(event) => setForm({ ...form, amount: sanitizeMoneyInput(event.target.value) })} onBlur={() => { if (form.amount) { try { setForm({ ...form, amount: formatMoneyInput(form.amount) }) } catch {} } }} inputMode="decimal" placeholder="0,00" /></label><label className="form-field"><span>Categoria</span><select required value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">Selecione</option>{availableCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="form-field"><span>Vencimento/recebimento</span><input required type="date" value={form.dueOn} min="2026-11-01" onChange={(event) => setForm({ ...form, dueOn: event.target.value })} /></label><label className="form-field"><span>Frequência</span><select value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value as PlannedItem['frequency'] })}><option value="monthly">Mensal</option><option value="unknown">Pendente de confirmação</option></select></label><div className="planning-form-actions"><button className="primary-button" type="submit"><Plus size={15} /> {editingId ? 'Salvar previsão' : 'Adicionar previsão'}</button>{editingId && <button className="outline-button" type="button" onClick={resetForm}>Cancelar edição</button>}</div></form><p className="planning-note"><CheckCircle2 size={14} /> Confirmar uma previsão cria uma única movimentação efetiva com chave idempotente.</p></article>
  </section>
}
