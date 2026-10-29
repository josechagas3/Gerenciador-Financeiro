import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

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

  const cookieStore = await cookies()
  const cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }> = []
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        secure: true,
        sameSite: 'none',
      },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(nextCookies) {
          nextCookies.forEach((cookie) => {
            cookiesToSet.push(cookie)
            cookieStore.set(cookie.name, cookie.value, cookie.options)
          })
        },
      },
    },
  )
  const { error } = await supabase.auth.signInWithPassword({ email: configuredEmail, password })

  if (error) {
    return NextResponse.json({ error: 'Credenciais inválidas.' }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
  return response
}
