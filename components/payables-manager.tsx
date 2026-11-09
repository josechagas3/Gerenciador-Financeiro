'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Edit3, MoreHorizontal, Plus, Search, X } from 'lucide-react'
import { formatMoneyCents } from '@/lib/finance/domain'

type Account = { id: string; name: string; isActive: boolean }
type Category = { id: string; name: string; kind: 'income' | 'expense' | 'both'; isActive: boolean }
type Payable = { id: string; categoryId: string | null; description: string; amountCents: string; dueOn: string; notes: string | null; status: 'pending' | 'paid' | 'cancelled'; paidAccountId: string | null; paidTransactionId: string | null; paidCents: string | null; paidOn: string | null }
type Movement = { id: string; accountId: string; categoryId: string | null; type: string; status: string; amountCents: string; effectiveOn: string; description: string; notes?: string | null; originalTransactionId?: string | null }
type Props = { snapshot: { accounts: Account[]; categories: Category[]; movements: Movement[]; payables: Payable[] }; refresh: () => Promise<unknown>; openCreateRequest?: number }
type Filter = 'all' | 'income' | 'expense' | 'pending' | 'paid' | 'cancelled'
type Entry = { id: string; kind: Exclude<Filter, 'all'>; date: string; description: string; notes: string | null; amountCents: string; accountId: string | null; categoryId: string | null; source: 'movement' | 'payable'; payable?: Payable }

const api = async (method: string, body: Record<string, unknown>) => {
  const response = await fetch('/api/finance', { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? 'Não foi possível concluir a operação.')
  return result
}
const today = () => new Date().toISOString().slice(0, 10)
const currentMonth = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` }
const shiftMonth = (value: string, amount: number) => { const base = value === 'all' ? new Date(`${currentMonth()}-01T00:00:00Z`) : new Date(`${value}-01T00:00:00Z`); base.setUTCMonth(base.getUTCMonth() + amount); return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}` }
const moneyInput = (cents: string) => formatMoneyCents(BigInt(cents)).replace(/^R\$\s?/, '')
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="form-field"><span>{label}</span>{children}</label>
}

export function PayablesManager({ snapshot, refresh, openCreateRequest = 0 }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [period, setPeriod] = useState(currentMonth)
  const [search, setSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Payable | null>(null)
  const [creating, setCreating] = useState(false)
  const [entryKind, setEntryKind] = useState<'income' | 'expense' | null>(null)
  const [paying, setPaying] = useState<Payable | null>(null)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [accountId, setAccountId] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const accountById = useMemo(() => new Map(snapshot.accounts.map((item) => [item.id, item.name])), [snapshot.accounts])
  const categoryById = useMemo(() => new Map(snapshot.categories.map((item) => [item.id, item.name])), [snapshot.categories])
  const entries = useMemo<Entry[]>(() => {
    const paidTransactionIds = new Set(snapshot.payables.map((item) => item.paidTransactionId).filter(Boolean))
    const reversalOfIds = new Set(snapshot.movements.map((item) => item.originalTransactionId).filter(Boolean))
    const movementEntries = snapshot.movements
      .filter((item) => item.status !== 'cancelled' && item.type !== 'reversal' && !paidTransactionIds.has(item.id) && !reversalOfIds.has(item.id))
      .map((item) => ({ id: item.id, kind: item.type === 'income' ? 'income' as const : 'expense' as const, date: item.effectiveOn, description: item.description, notes: item.notes ?? null, amountCents: item.amountCents, accountId: item.accountId, categoryId: item.categoryId, source: 'movement' as const }))
    const payableEntries = snapshot.payables.map((item) => ({ id: item.id, kind: item.status, date: item.status === 'paid' ? item.paidOn ?? item.dueOn : item.dueOn, description: item.description, notes: item.notes, amountCents: item.amountCents, accountId: item.paidAccountId, categoryId: item.categoryId, source: 'payable' as const, payable: item }))
    return [...movementEntries, ...payableEntries].sort((a, b) => b.date.localeCompare(a.date))
  }, [snapshot.movements, snapshot.payables])

  const filtered = useMemo(() => {
    const term = normalize(search)
    return entries.filter((item) => {
      const matchesPeriod = period === 'all' || item.date.startsWith(period)
      const matchesFilter = filter === 'all' || (filter === 'expense' ? ['expense', 'pending', 'paid', 'cancelled'].includes(item.kind) : item.kind === filter)
      const haystack = normalize(`${item.description} ${item.notes ?? ''} ${categoryById.get(item.categoryId ?? '') ?? ''} ${accountById.get(item.accountId ?? '') ?? ''}`)
      return matchesPeriod && matchesFilter && (!term || haystack.includes(term)) && (!accountFilter || item.accountId === accountFilter) && (!categoryFilter || item.categoryId === categoryFilter)
    })
  }, [accountById, accountFilter, categoryById, categoryFilter, entries, filter, period, search])

  useEffect(() => setPage(1), [filter, period, search, accountFilter, categoryFilter])
  const pageSize = 25
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visibleEntries = filtered.slice((page - 1) * pageSize, page * pageSize)
  const summary = filtered.reduce((result, item) => {
    const amountCents = BigInt(item.amountCents)
    if (item.kind === 'income') result.income += amountCents
    if (item.kind === 'expense' || item.kind === 'paid') result.expense += amountCents
    if (item.kind === 'pending') result.pending += amountCents
    return result
  }, { income: 0n, expense: 0n, pending: 0n })
  const pendingTotal = snapshot.payables.filter((item) => item.status === 'pending').reduce((sum, item) => sum + BigInt(item.amountCents), 0n)

  useEffect(() => {
    if (openCreateRequest) {
      setError(''); setCreating(true); setEntryKind(null); setEditing(null); setPaying(null); setAmount(''); setDate(today()); setDescription(''); setCategoryId(''); setNotes('')
    }
  }, [openCreateRequest])

  const openEdit = (item: Payable) => { setError(''); setEditing(item); setDescription(item.description); setCategoryId(item.categoryId ?? ''); setNotes(item.notes ?? ''); setAmount(moneyInput(item.amountCents)); setDate(item.status === 'paid' ? item.paidOn ?? today() : item.dueOn) }
  const closeModal = () => { if (!busy) { setCreating(false); setEntryKind(null); setEditing(null); setPaying(null); setError('') } }
  const createPayable = async (event: React.FormEvent) => { event.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await api('POST', { resource: 'payables', action: 'create', data: { categoryId: categoryId || null, amountCents: amount, dueOn: date, description, notes, operationKey: crypto.randomUUID() } }); closeModal(); await refresh() } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível cadastrar a despesa.') } finally { setBusy(false) } }
  const createIncome = async (event: React.FormEvent) => { event.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await api('POST', { resource: 'transactions', action: 'create', data: { accountId, categoryId, type: 'income', amountCents: amount, effectiveOn: date, description, notes, idempotencyKey: crypto.randomUUID() } }); closeModal(); await refresh() } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível cadastrar a receita.') } finally { setBusy(false) } }
  const saveEdit = async (event: React.FormEvent) => { event.preventDefault(); if (!editing || busy) return; setBusy(true); setError(''); try { await api('PATCH', { resource: 'payables', id: editing.id, data: { status: editing.status, categoryId: categoryId || null, amountCents: amount, dueOn: editing.status === 'pending' ? date : null, paidOn: editing.status === 'paid' ? date : null, description, notes, operationKey: crypto.randomUUID() } }); closeModal(); await refresh() } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar a despesa.') } finally { setBusy(false) } }
  const remove = async (item: Payable) => { if (item.status === 'cancelled') { setError('Esta despesa já está cancelada. A listagem será atualizada.'); await refresh(); return }; const prompt = item.status === 'paid' ? 'Excluir esta despesa paga? O lançamento original será preservado e um estorno será criado na conta.' : 'Excluir esta despesa pendente? Esta ação não pode ser desfeita.'; if (!window.confirm(prompt)) return; setBusy(true); setError(''); try { await api('POST', { resource: 'payables', action: 'delete', data: { payableId: item.id, operationKey: crypto.randomUUID() } }); await refresh() } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível excluir a despesa.'); await refresh() } finally { setBusy(false) } }
  const openPay = (item: Payable) => { setError(''); setPaying(item); setAccountId(''); setDate(today()) }
  const pay = async (event: React.FormEvent) => { event.preventDefault(); if (!paying || busy) return; setBusy(true); setError(''); try { await api('POST', { resource: 'payables', action: 'pay', data: { payableId: paying.id, accountId, paidCents: paying.amountCents, paidOn: date, operationKey: crypto.randomUUID() } }); closeModal(); await refresh() } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível marcar como paga.') } finally { setBusy(false) } }

  const incomeCategories = snapshot.categories.filter((item) => item.isActive && (item.kind === 'income' || item.kind === 'both'))
  const expenseCategories = snapshot.categories.filter((item) => item.isActive && (item.kind === 'expense' || item.kind === 'both'))
  const activeAccounts = snapshot.accounts.filter((item) => item.isActive)
  const filterLabels: Array<[Filter, string]> = [['all', 'Todas'], ['income', 'Receitas'], ['expense', 'Despesas'], ['pending', 'Pendentes'], ['paid', 'Pagas'], ['cancelled', 'Canceladas']]
  const periodLabel = period === 'all' ? 'Todos os períodos' : new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period}-01T00:00:00Z`))

  return <section className="entries-module">
    <article className="panel entries-panel">
      <div className="panel-heading entries-heading"><div><p className="eyebrow">Lançamentos</p><h2>Movimentações financeiras</h2><p>Pesquise e filtre receitas, despesas previstas e pagamentos efetivados.</p></div><span className="data-badge">Previsto: {formatMoneyCents(pendingTotal)}</span></div>
      <div className="entries-controls">
        <label className="search-field"><Search size={16} aria-hidden="true" /><span className="sr-only">Pesquisar lançamentos</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar por descrição, estabelecimento, categoria ou conta" /><button type="button" className="clear-search" aria-label="Limpar pesquisa" onClick={() => setSearch('')} disabled={!search}><X size={14} /></button></label>
        <div className="period-field"><span>Período</span><div className="period-picker"><button type="button" aria-label="Mês anterior" onClick={() => setPeriod(shiftMonth(period, -1))}><ChevronLeft size={14} /></button><select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="all">Todos os períodos</option><option value={currentMonth()}>Mês atual</option></select><input type="month" value={period === 'all' ? currentMonth() : period} onChange={(event) => setPeriod(event.target.value || 'all')} aria-label="Selecionar mês e ano" /><button type="button" aria-label="Próximo mês" onClick={() => setPeriod(shiftMonth(period, 1))}><ChevronRight size={14} /></button></div></div>
        <label className="compact-filter"><span>Conta</span><select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}><option value="">Todas as contas</option>{snapshot.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="compact-filter"><span>Categoria</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">Todas as categorias</option>{snapshot.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div>
      <div className="filter-tabs" role="tablist" aria-label="Filtrar lançamentos">{filterLabels.map(([value, label]) => <button key={value} className={filter === value ? 'filter-tab filter-tab-active' : 'filter-tab'} onClick={() => setFilter(value)} role="tab" aria-selected={filter === value}>{label}</button>)}</div>
      <div className="entries-summary" aria-label="Resumo do período"><div><span>Receitas</span><strong className="positive">{formatMoneyCents(summary.income)}</strong></div><div><span>Despesas pagas</span><strong className="negative">{formatMoneyCents(summary.expense)}</strong></div><div><span>Resultado</span><strong>{formatMoneyCents(summary.income - summary.expense)}</strong></div><div><span>Lançamentos</span><strong>{filtered.length}</strong></div></div>
      <p className="filter-context">{periodLabel} · valores calculados com os filtros aplicados{summary.pending > 0n ? ` · previsto pendente: ${formatMoneyCents(summary.pending)}` : ''}</p>
      {error && <p className="auth-error">{error}</p>}
      {visibleEntries.length ? <div className="payable-list">{visibleEntries.map((item) => { const category = categoryById.get(item.categoryId ?? '') ?? 'Sem categoria'; const account = accountById.get(item.accountId ?? ''); const statusLabel = item.kind === 'income' ? 'Receita' : item.kind === 'expense' ? 'Despesa' : item.kind === 'paid' ? 'Paga' : item.kind === 'pending' ? 'Pendente' : 'Cancelada'; return <article className="payable-row" key={`${item.source}-${item.id}`}><div className={`payable-status payable-status-${item.kind}`} aria-label={statusLabel}>{item.kind === 'income' || item.kind === 'paid' ? <Check size={15} /> : <span />}</div><div className="payable-main"><strong>{item.description}</strong><small>{statusLabel} · {category} · {item.kind === 'paid' ? `Pago em ${item.date}` : item.kind === 'pending' ? `Vence em ${item.date}` : `Em ${item.date}`}{account ? ` · ${account}` : ''}</small>{item.notes && <small>{item.notes}</small>}</div><strong className="payable-amount">{formatMoneyCents(BigInt(item.amountCents))}</strong>{item.payable && <details className="action-menu"><summary aria-label={`Ações para ${item.description}`}><MoreHorizontal size={18} /></summary><div className="action-menu-content"><button onClick={() => openEdit(item.payable!)}><Edit3 size={14} /> Editar</button>{item.payable.status === 'pending' && <button onClick={() => openPay(item.payable!)}><Check size={14} /> Marcar como paga</button>}{item.payable.status !== 'cancelled' && <button className="danger-action" onClick={() => remove(item.payable!)}>Excluir</button>}</div></details>}</article> })}</div> : <div className="empty-state"><p className="empty-state-title">Nenhum lançamento encontrado</p><p className="empty-state-description">Ajuste o período ou os filtros para encontrar outros registros.</p></div>}
      {pageCount > 1 && <div className="pagination"><button className="small-button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}><ChevronLeft size={15} /> Anterior</button><span>Página {page} de {pageCount}</span><button className="small-button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page === pageCount}>Próxima <ChevronRight size={15} /></button></div>}
    </article>

    {creating && <div className="modal-backdrop" role="presentation"><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-entry-title"><div className="modal-heading"><div><p className="eyebrow">Novo lançamento</p><h2 id="create-entry-title">O que deseja registrar?</h2></div><button className="icon-button" onClick={closeModal} aria-label="Fechar"><X size={18} /></button></div>{!entryKind ? <div className="entry-kind-options"><button className="entry-kind-card entry-kind-income" onClick={() => setEntryKind('income')}><span className="entry-kind-icon">↑</span><strong>Receita</strong><small>Uma entrada recebida em uma conta.</small></button><button className="entry-kind-card entry-kind-expense" onClick={() => setEntryKind('expense')}><span className="entry-kind-icon">↓</span><strong>Despesa</strong><small>Um compromisso que ficará pendente até o pagamento.</small></button></div> : entryKind === 'income' ? <form onSubmit={createIncome}><Field label="Conta"><select required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Selecione uma conta</option>{activeAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Categoria"><select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Selecione uma categoria</option>{incomeCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="field-row"><Field label="Valor"><input required value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0,00" /></Field><Field label="Data efetiva"><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field></div><Field label="Descrição"><input required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex.: Salário" /></Field><Field label="Observação (opcional)"><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>{error && <p className="auth-error">{error}</p>}<button className="primary-button income-button" disabled={busy} type="submit"><Plus size={16} /> Confirmar receita</button></form> : <form onSubmit={createPayable}><Field label="Categoria"><select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Selecione uma categoria</option>{expenseCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="field-row"><Field label="Valor"><input required value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0,00" /></Field><Field label="Vencimento"><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field></div><Field label="Descrição"><input required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex.: Mercado" /></Field><Field label="Observação (opcional)"><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>{error && <p className="auth-error">{error}</p>}<button className="primary-button expense-button" disabled={busy} type="submit"><Plus size={16} /> Cadastrar despesa</button></form>}</div></div>}
    {editing && <div className="modal-backdrop" role="presentation"><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-payable-title"><div className="modal-heading"><div><p className="eyebrow">Editar despesa</p><h2 id="edit-payable-title">{editing.status === 'paid' ? 'Despesa paga' : 'Despesa pendente'}</h2></div><button className="icon-button" onClick={closeModal} aria-label="Fechar"><X size={18} /></button></div><form onSubmit={saveEdit}><Field label="Descrição"><input required value={description} onChange={(event) => setDescription(event.target.value)} /></Field><Field label="Categoria"><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Selecione uma categoria</option>{expenseCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="field-row"><Field label="Valor"><input required value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0,00" /></Field><Field label={editing.status === 'paid' ? 'Data do pagamento' : 'Vencimento'}><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field></div><Field label="Observação (opcional)"><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>{error && <p className="auth-error">{error}</p>}<button className="primary-button" disabled={busy} type="submit">Salvar alterações</button></form></div></div>}
    {paying && <div className="modal-backdrop" role="presentation"><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="pay-payable-title"><div className="modal-heading"><div><p className="eyebrow">Pagamento</p><h2 id="pay-payable-title">Marcar como paga</h2></div><button className="icon-button" onClick={closeModal} aria-label="Fechar"><X size={18} /></button></div><form onSubmit={pay}><Field label="Conta de pagamento"><select required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Selecione uma conta</option>{activeAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Data do pagamento"><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field><p className="modal-summary">Valor: <strong>{formatMoneyCents(BigInt(paying.amountCents))}</strong></p>{error && <p className="auth-error">{error}</p>}<button className="primary-button" disabled={busy} type="submit"><Check size={16} /> Confirmar pagamento</button></form></div></div>}
  </section>
}
