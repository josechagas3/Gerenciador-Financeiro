'use client'

import { useEffect, useState } from 'react'
import { Check, Edit3, MoreHorizontal, Plus, Trash2, X } from 'lucide-react'
import { formatMoneyCents } from '@/lib/finance/domain'

type Account = { id: string; name: string; isActive: boolean }
type Category = { id: string; name: string; kind: 'income' | 'expense' | 'both'; isActive: boolean }
type Payable = { id: string; categoryId: string | null; description: string; amountCents: string; dueOn: string; notes: string | null; status: 'pending' | 'paid' | 'cancelled'; paidAccountId: string | null; paidTransactionId: string | null; paidCents: string | null; paidOn: string | null }

type Props = { snapshot: { accounts: Account[]; categories: Category[]; payables: Payable[] }; refresh: () => Promise<unknown>; openCreateRequest?: number }

const api = async (method: string, body: Record<string, unknown>) => {
  const response = await fetch('/api/finance', { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error ?? 'Não foi possível concluir a operação.')
  return result
}
const today = () => new Date().toISOString().slice(0, 10)
const moneyInput = (cents: string) => formatMoneyCents(BigInt(cents)).replace(/^R\$\s?/, '')

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="form-field"><span>{label}</span>{children}</label>
}

export function PayablesManager({ snapshot, refresh, openCreateRequest = 0 }: Props) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'paid' | 'cancelled'>('all')
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
  const filtered = snapshot.payables.filter((item) => (filter === 'all' ? item.status !== 'cancelled' : item.status === filter))
  const pendingTotal = snapshot.payables.filter((item) => item.status === 'pending').reduce((sum, item) => sum + BigInt(item.amountCents), 0n)

  useEffect(() => {
    if (openCreateRequest) {
      setError('')
      setCreating(true)
      setEntryKind(null)
      setEditing(null)
      setPaying(null)
      setAmount('')
      setDate(today())
      setDescription('')
      setCategoryId('')
      setNotes('')
    }
  }, [openCreateRequest])

  const openEdit = (item: Payable) => {
    setError(''); setEditing(item); setDescription(item.description); setCategoryId(item.categoryId ?? ''); setNotes(item.notes ?? '')
    setAmount(moneyInput(item.amountCents)); setDate(item.status === 'paid' ? item.paidOn ?? today() : item.dueOn)
  }
  const closeModal = () => { if (!busy) { setCreating(false); setEntryKind(null); setEditing(null); setPaying(null); setError('') } }
  const createPayable = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('')
    try {
      await api('POST', { resource: 'payables', action: 'create', data: { categoryId: categoryId || null, amountCents: amount, dueOn: date, description, notes, operationKey: crypto.randomUUID() } })
      closeModal(); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível cadastrar a despesa.') } finally { setBusy(false) }
  }
  const createIncome = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('')
    try {
      await api('POST', { resource: 'transactions', action: 'create', data: { accountId, categoryId, type: 'income', amountCents: amount, effectiveOn: date, description, notes, idempotencyKey: crypto.randomUUID() } })
      closeModal(); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível cadastrar a receita.') } finally { setBusy(false) }
  }
  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!editing || busy) return; setBusy(true); setError('')
    try {
      await api('PATCH', { resource: 'payables', id: editing.id, data: { status: editing.status, categoryId: categoryId || null, amountCents: amount, dueOn: editing.status === 'pending' ? date : null, paidOn: editing.status === 'paid' ? date : null, description, notes, operationKey: crypto.randomUUID() } })
      closeModal(); await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar a despesa.') } finally { setBusy(false) }
  }
  const remove = async (item: Payable) => {
    if (item.status === 'cancelled') {
      setError('Esta despesa já está cancelada. A listagem será atualizada.')
      await refresh()
      return
    }
    const prompt = item.status === 'paid' ? 'Excluir esta despesa paga? O lançamento original será preservado e um estorno será criado na conta.' : 'Excluir esta despesa pendente? Esta ação não pode ser desfeita.'
    if (!window.confirm(prompt)) return
    setBusy(true); setError('')
    try { await api('POST', { resource: 'payables', action: 'delete', data: { payableId: item.id, operationKey: crypto.randomUUID() } }); await refresh() }
    catch (e) {
      const message = e instanceof Error ? e.message : 'Não foi possível excluir a despesa.'
      setError(message.includes('already cancelled') ? 'Esta despesa já está cancelada. A listagem foi atualizada.' : message)
      await refresh()
    } finally { setBusy(false) }
  }
  const openPay = (item: Payable) => { setError(''); setPaying(item); setAccountId(''); setDate(today()) }
  const incomeCategories = snapshot.categories.filter((item) => item.isActive && (item.kind === 'income' || item.kind === 'both'))
  const expenseCategories = snapshot.categories.filter((item) => item.isActive && (item.kind === 'expense' || item.kind === 'both'))
  const activeAccounts = snapshot.accounts.filter((item) => item.isActive)
  const pay = async (event: React.FormEvent) => {
    event.preventDefault(); if (!paying || busy) return; setBusy(true); setError('')
    try { await api('POST', { resource: 'payables', action: 'pay', data: { payableId: paying.id, accountId, paidCents: paying.amountCents, paidOn: date, operationKey: crypto.randomUUID() } }); closeModal(); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível marcar como paga.') } finally { setBusy(false) }
  }
  return <section className="module-grid"><article className="panel"><div className="panel-heading"><div><p className="eyebrow">Lançamentos</p><h2>Lançamentos</h2><p>Despesas pendentes e receitas que movimentam suas contas.</p></div><span className="data-badge">Pendente: {formatMoneyCents(pendingTotal)}</span></div><div className="filter-tabs" role="tablist" aria-label="Filtrar despesas">{(['all', 'pending', 'paid', 'cancelled'] as const).map((value) => <button key={value} className={filter === value ? 'filter-tab filter-tab-active' : 'filter-tab'} onClick={() => setFilter(value)} role="tab" aria-selected={filter === value}>{value === 'all' ? 'Ativas' : value === 'pending' ? 'Pendentes' : value === 'paid' ? 'Pagas' : 'Canceladas'}</button>)}</div>{error && <p className="auth-error">{error}</p>}{filtered.length ? <div className="payable-list">{filtered.map((item) => { const category = snapshot.categories.find((categoryItem) => categoryItem.id === item.categoryId); return <article className="payable-row" key={item.id}><div className={`payable-status payable-status-${item.status}`} aria-label={item.status === 'paid' ? 'Paga' : item.status === 'pending' ? 'Pendente' : 'Cancelada'}>{item.status === 'paid' ? <Check size={15} /> : <span />}</div><div className="payable-main"><strong>{item.description}</strong><small>{category?.name ?? 'Sem categoria'} · {item.status === 'paid' ? `Pago em ${item.paidOn}` : `Vence em ${item.dueOn}`}</small>{item.notes && <small>{item.notes}</small>}</div><strong className="payable-amount">{formatMoneyCents(BigInt(item.amountCents))}</strong><details className="action-menu"><summary aria-label={`Ações para ${item.description}`}><MoreHorizontal size={18} /></summary><div className="action-menu-content"><button onClick={() => openEdit(item)}><Edit3 size={14} /> Editar</button>{item.status === 'pending' && <button onClick={() => openPay(item)}><Check size={14} /> Marcar como paga</button>}{item.status !== 'cancelled' && <button className="danger-action" onClick={() => remove(item)}><Trash2 size={14} /> Excluir</button>}</div></details></article> })}</div> : <div className="empty-state"><div className="empty-state-icon"><Plus size={20} /></div><p className="empty-state-title">Nenhuma despesa encontrada</p><p className="empty-state-description">Cadastre uma despesa no formulário ao lado para começar.</p></div>}</article><article className="panel form-panel"><div className="panel-heading"><div><h2>Como funciona</h2><p>Alterações seguras e rastreáveis.</p></div></div><div className="empty-state"><p className="empty-state-title">Despesas pendentes</p><p className="empty-state-description">Podem ter descrição, categoria, valor, vencimento e observação alterados antes do pagamento.</p><p className="empty-state-title">Despesas pagas</p><p className="empty-state-description">A edição de valor e data atualiza a movimentação vinculada. A exclusão cria um estorno único e preserva o histórico.</p></div></article>{creating && <div className="modal-backdrop" role="presentation"><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-payable-title"><div className="modal-heading"><div><p className="eyebrow">Novo lançamento</p><h2 id="create-payable-title">{entryKind === 'income' ? 'Cadastrar receita' : entryKind === 'expense' ? 'Cadastrar despesa pendente' : 'Escolha o tipo'}</h2></div><button className="icon-button" onClick={closeModal} aria-label="Fechar"><X size={18} /></button></div>{!entryKind ? <div className="entry-kind-options"><button type="button" className="entry-kind-card entry-kind-income" onClick={() => { setEntryKind('income'); setError(''); setDate(today()) }}><span className="entry-kind-icon">↑</span><strong>Receita</strong><small>Valor recebido que entra em uma conta.</small></button><button type="button" className="entry-kind-card entry-kind-expense" onClick={() => { setEntryKind('expense'); setError(''); setDate(today()) }}><span className="entry-kind-icon">↓</span><strong>Despesa</strong><small>Conta pendente para pagar depois.</small></button></div> : entryKind === 'income' ? <form onSubmit={createIncome}><Field label="Categoria da receita"><select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Selecione uma categoria</option>{incomeCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="field-row"><Field label="Valor recebido"><input required value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0,00" /></Field><Field label="Data do recebimento"><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field></div><Field label="Conta de destino"><select required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Selecione uma conta</option>{activeAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Descrição"><input required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex.: Salário" /></Field><Field label="Observação (opcional)"><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>{error && <p className="auth-error">{error}</p>}<button className="primary-button income-button" disabled={busy} type="submit"><Plus size={16} /> Confirmar receita</button></form> : <form onSubmit={createPayable}><Field label="Categoria"><select required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Selecione uma categoria</option>{expenseCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="field-row"><Field label="Valor"><input required value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0,00" /></Field><Field label="Vencimento"><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field></div><Field label="Descrição"><input required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex.: Mercado" /></Field><Field label="Observação (opcional)"><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>{error && <p className="auth-error">{error}</p>}<button className="primary-button expense-button" disabled={busy} type="submit"><Plus size={16} /> Cadastrar despesa</button></form>}</div></div>}{editing && <div className="modal-backdrop" role="presentation"><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-payable-title"><div className="modal-heading"><div><p className="eyebrow">Editar despesa</p><h2 id="edit-payable-title">{editing.status === 'paid' ? 'Despesa paga' : 'Despesa pendente'}</h2></div><button className="icon-button" onClick={closeModal} aria-label="Fechar"><X size={18} /></button></div><form onSubmit={saveEdit}><Field label="Descrição"><input required value={description} onChange={(event) => setDescription(event.target.value)} /></Field><Field label="Categoria"><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Selecione uma categoria</option>{expenseCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><div className="field-row"><Field label="Valor"><input required value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0,00" /></Field><Field label={editing.status === 'paid' ? 'Data do pagamento' : 'Vencimento'}><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field></div><Field label="Observação (opcional)"><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>{error && <p className="auth-error">{error}</p>}<button className="primary-button" disabled={busy} type="submit">Salvar alterações</button></form></div></div>}{paying && <div className="modal-backdrop" role="presentation"><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="pay-payable-title"><div className="modal-heading"><div><p className="eyebrow">Pagamento</p><h2 id="pay-payable-title">Marcar como paga</h2></div><button className="icon-button" onClick={closeModal} aria-label="Fechar"><X size={18} /></button></div><form onSubmit={pay}><Field label="Conta de pagamento"><select required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Selecione uma conta</option>{snapshot.accounts.filter((item) => item.isActive).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Data do pagamento"><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field><p className="modal-summary">Valor: <strong>{formatMoneyCents(BigInt(paying.amountCents))}</strong></p>{error && <p className="auth-error">{error}</p>}<button className="primary-button" disabled={busy} type="submit"><Check size={16} /> Confirmar pagamento</button></form></div></div>}</section>
}
