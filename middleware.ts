import { updateSession } from '@/lib/supabase/proxy'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: ['/api/finance/:path*'],
}
