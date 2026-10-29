'use client'

import { FormEvent, useState } from 'react'
import { Eye, EyeOff, KeyRound, LockKeyhole, UserRound, Wallet } from 'lucide-react'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function signIn(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!response.ok) {
        setError('Nome de usuário ou senha inválidos.')
        setLoading(false)
        return
      }
      window.location.assign('/')
    } catch {
      setError('Não foi possível concluir o login. Tente novamente.')
      setLoading(false)
    }
  }

  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><span className="brand-mark"><Wallet size={19} /></span><span>Meu Financeiro</span></div><div className="auth-heading"><p className="eyebrow">Acesso pessoal</p><h1>Bem-vindo de volta.</h1><p>Entre para acompanhar suas finanças com segurança.</p></div><form className="auth-form" onSubmit={signIn}><label><span>Nome de usuário</span><div className="auth-input"><UserRound size={16} /><input type="text" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" minLength={3} maxLength={64} required /></div></label><label><span>Senha</span><div className="auth-input"><LockKeyhole size={16} /><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /><button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button auth-submit" disabled={loading}>{loading ? 'Entrando...' : <><KeyRound size={15} />Entrar</>}</button></form><p className="auth-footnote">Acesso restrito ao proprietário deste gerenciador.</p></section></main>
}
