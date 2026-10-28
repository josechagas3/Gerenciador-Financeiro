'use client'

import { useState } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  CreditCard,
  FileText,
  Flag,
  LayoutDashboard,
  Menu,
  PiggyBank,
  Plus,
  ReceiptText,
  Settings2,
  Tags,
  Target,
  Wallet,
  X,
} from 'lucide-react'

const navigation = [
  { label: 'Visão geral', icon: LayoutDashboard, active: true },
  { label: 'Contas', icon: Wallet },
  { label: 'Lançamentos', icon: ReceiptText },
  { label: 'Categorias', icon: Tags },
  { label: 'Cartões', icon: CreditCard },
  { label: 'Faturas', icon: FileText },
  { label: 'Dívidas', icon: BookOpen },
  { label: 'Investimentos', icon: BriefcaseBusiness },
  { label: 'Objetivos', icon: Target },
  { label: 'Relatórios', icon: BarChart3 },
]

const metrics = [
  { label: 'Saldo total', value: 'R$ 0,00', helper: 'Nenhuma conta cadastrada', icon: Wallet, tone: 'green' },
  { label: 'Receitas do mês', value: 'R$ 0,00', helper: 'Nenhuma receita registrada', icon: ArrowUpRight, tone: 'blue' },
  { label: 'Despesas do mês', value: 'R$ 0,00', helper: 'Nenhuma despesa registrada', icon: ArrowDownLeft, tone: 'orange' },
  { label: 'Investimentos', value: 'R$ 0,00', helper: 'Nenhum investimento cadastrado', icon: PiggyBank, tone: 'purple' },
]

function EmptyState({ icon: Icon, title, description }: { icon: typeof ReceiptText; title: string; description: string }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon"><Icon size={20} strokeWidth={1.8} /></div>
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-description">{description}</p>
    </div>
  )
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      {open && <button className="sidebar-overlay" aria-label="Fechar menu" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><Wallet size={18} strokeWidth={2.2} /></div>
          <span className="brand-name">Meu Financeiro</span>
          <button className="mobile-close" aria-label="Fechar menu" onClick={onClose}><X size={19} /></button>
        </div>
        <div className="sidebar-label">MENU PRINCIPAL</div>
        <nav className="nav-list" aria-label="Navegação principal">
          {navigation.map(({ label, icon: Icon, active }) => (
            <button key={label} className={`nav-item ${active ? 'nav-item-active' : ''}`} onClick={onClose}>
              <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
              <span>{label}</span>
              {active && <span className="active-indicator" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item"><Settings2 size={18} /><span>Configurações</span></button>
          <div className="security-note">
            <div className="security-dot" />
            <div><strong>Dados protegidos</strong><span>Acesso privado e seguro</span></div>
          </div>
        </div>
      </aside>
    </>
  )
}

export default function FinanceDashboard() {
  const [menuOpen, setMenuOpen] = useState(false)
  const today = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  const formattedToday = today.charAt(0).toUpperCase() + today.slice(1)

  return (
    <div className="finance-app">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" aria-label="Abrir menu" onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
          <div className="breadcrumb"><span>Visão geral</span><ChevronRight size={14} /><strong>Dashboard</strong></div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="Notificações"><Bell size={19} /><span className="notification-dot" /></button>
            <div className="avatar" aria-label="Perfil de usuário">EU</div>
          </div>
        </header>
        <div className="page-wrapper">
          <section className="welcome-row">
            <div><p className="eyebrow">{formattedToday}</p><h1>Olá, seja bem-vindo.</h1><p className="welcome-copy">Tenha uma visão clara e tranquila das suas finanças.</p></div>
            <button className="primary-button"><Plus size={17} /> Adicionar lançamento</button>
          </section>

          <section className="metrics-grid" aria-label="Resumo financeiro">
            {metrics.map(({ label, value, helper, icon: Icon, tone }) => (
              <article className="metric-card" key={label}>
                <div className={`metric-icon metric-icon-${tone}`}><Icon size={19} /></div>
                <p className="metric-label">{label}</p><p className="metric-value">{value}</p><p className="metric-helper">{helper}</p>
              </article>
            ))}
          </section>

          <section className="content-grid">
            <article className="panel cashflow-panel">
              <div className="panel-heading"><div><h2>Fluxo de caixa</h2><p>Receitas e despesas ao longo do tempo</p></div><button className="select-button">Este mês <ChevronRight size={14} /></button></div>
              <div className="chart-empty"><div className="chart-illustration"><BarChart3 size={27} /></div><strong>Seu fluxo de caixa aparecerá aqui</strong><span>Adicione lançamentos para acompanhar sua evolução mensal.</span><button className="text-button">Adicionar primeiro lançamento <ArrowUpRight size={15} /></button></div>
            </article>
            <article className="panel budget-panel">
              <div className="panel-heading"><div><h2>Orçamento</h2><p>Acompanhe seus limites mensais</p></div><button className="more-button" aria-label="Mais opções">•••</button></div>
              <EmptyState icon={PiggyBank} title="Nenhum orçamento criado" description="Crie categorias e defina limites para começar." />
              <button className="outline-button"><Plus size={16} /> Criar orçamento</button>
            </article>
          </section>

          <section className="lower-grid">
            <article className="panel activity-panel"><div className="panel-heading"><div><h2>Movimentações recentes</h2><p>Seus últimos lançamentos</p></div><button className="link-button">Ver todas <ChevronRight size={14} /></button></div><EmptyState icon={ReceiptText} title="Ainda não há movimentações" description="Seus lançamentos aparecerão nesta lista." /></article>
            <article className="panel due-panel"><div className="panel-heading"><div><h2>Próximos vencimentos</h2><p>Contas e faturas a pagar</p></div><CalendarDays size={19} className="panel-heading-icon" /></div><EmptyState icon={CalendarDays} title="Tudo tranquilo por aqui" description="Você não possui contas ou faturas cadastradas." /></article>
          </section>

          <div className="info-banner"><div className="info-banner-icon"><Flag size={17} /></div><div><strong>Comece organizando suas finanças</strong><span>Cadastre sua primeira conta para acompanhar seu saldo em um só lugar.</span></div><button className="banner-button">Cadastrar conta <ChevronRight size={15} /></button></div>
          <p className="demo-note">Tela inicial sem dados financeiros. Informações serão exibidas após o cadastro.</p>
        </div>
      </main>
    </div>
  )
}
