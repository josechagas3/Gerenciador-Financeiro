import { updateSession } from '@/lib/supabase/proxy'
import type { NextRequest } from 'next/server'

import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  const response = await updateSession(request)
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => request.cookies.getAll(), setAll: () => undefined },
  })
  const { data: { user } } = await supabase.auth.getUser()
  const isLogin = request.nextUrl.pathname.startsWith('/auth/login')
  const isCallback = request.nextUrl.pathname.startsWith('/auth/callback')
  const isFinanceApi = request.nextUrl.pathname.startsWith('/api/finance')
  if (!user && !isLogin && !isCallback && !isFinanceApi) return NextResponse.redirect(new URL('/auth/login', request.url))
  if (user && isLogin) return NextResponse.redirect(new URL('/', request.url))
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
