import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const usernamePattern = /^[a-zA-Z0-9._-]{3,64}$/

export async function POST(request: Request) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Credenciais inválidas.' }, { status: 400 })
  }

  const username = typeof payload === 'object' && payload !== null && 'username' in payload && typeof payload.username === 'string'
    ? payload.username.trim()
    : ''
  const password = typeof payload === 'object' && payload !== null && 'password' in payload && typeof payload.password === 'string'
    ? payload.password
    : ''
  const configuredUsername = process.env.AUTH_USERNAME?.trim()
  const configuredEmail = process.env.AUTH_LOGIN_EMAIL?.trim()

  if (!usernamePattern.test(username) || !configuredUsername || !configuredEmail || username.toLowerCase() !== configuredUsername.toLowerCase() || password.length === 0) {
    return NextResponse.json({ error: 'Credenciais inválidas.' }, { status: 401 })
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email: configuredEmail, password })

  if (error) {
    return NextResponse.json({ error: 'Credenciais inválidas.' }, { status: 401 })
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
