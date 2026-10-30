type Card = { id: string; name: string; brand: string; availableCents: string }
type Invoice = { id: string; status: string; totalCents: string }

type Props = { cards: Card[]; invoices: Invoice[] }

const money = (value: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0) / 100)

export function InvoiceAvailabilityNotice({ cards, invoices }: Props) {
  if (invoices.length > 0) return null
  return <article className="panel form-panel invoice-entry-panel"><div className="panel-heading"><div><p className="eyebrow">Cadastro de faturas</p><h2>Importar fatura existente</h2><p>Nenhuma fatura foi encontrada para este usuário. O cartão cadastrado continua disponível, mas a importação histórica só pode começar depois que a fatura correspondente existir no Supabase.</p></div></div><div className="account-list">{cards.length > 0 ? cards.map((card) => <div className="account-row" key={card.id}><div><strong>{card.name}</strong><span>{card.brand} · limite disponível {money(card.availableCents)}</span></div><span className="status-pill status-pill-neutral">Sem fatura</span></div>) : <p className="empty-state-description">Nenhum cartão disponível. Cadastre o cartão em Cartões antes de importar uma fatura.</p>}</div><p className="form-hint">Não crie uma fatura fictícia: a fatura real precisa ser inserida por uma migration/importação aprovada. Depois disso, ela aparecerá aqui e o formulário de compras históricas ficará disponível.</p></article>
}
