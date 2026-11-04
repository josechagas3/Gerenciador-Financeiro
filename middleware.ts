import { updateSession } from '@/lib/supabase/proxy'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request)
  const isLogin = request.nextUrl.pathname.startsWith('/auth/login')
  const isCallback = request.nextUrl.pathname.startsWith('/auth/callback')
  const isFinanceApi = request.nextUrl.pathname.startsWith('/api/finance')
  const isAuthApi = request.nextUrl.pathname.startsWith('/api/auth/login')
  if (!user && !isLogin && !isCallback && !isFinanceApi && !isAuthApi) return NextResponse.redirect(new URL('/auth/login', request.url))
  if (user && isLogin) return NextResponse.redirect(new URL('/', request.url))
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|brand-logo.png).*)']
}
