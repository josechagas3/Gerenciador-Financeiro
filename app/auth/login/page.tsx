'use client'

import { FormEvent, useState } from 'react'
import { LockKeyhole, Mail, Wallet } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function signIn(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    const { error: authError } = await createClient().auth.signInWithPassword({ email, password })
    if (authError) {
      setError(authError.message.toLowerCase().includes('confirm') ? 'Confirme seu e-mail antes de entrar.' : 'E-mail ou senha inválidos.')
      setLoading(false)
      return
    }
    window.location.assign('/')
  }

  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><span className="brand-mark"><Wallet size={19} /></span><span>Meu Financeiro</span></div><div className="auth-heading"><p className="eyebrow">Acesso pessoal</p><h1>Bem-vindo de volta.</h1><p>Entre para acompanhar suas finanças com segurança.</p></div><form className="auth-form" onSubmit={signIn}><label><span>E-mail</span><div className="auth-input"><Mail size={16} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></div></label><label><span>Senha</span><div className="auth-input"><LockKeyhole size={16} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></div></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button auth-submit" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button></form><p className="auth-footnote">Acesso restrito ao proprietário deste gerenciador.</p></section></main>
}
