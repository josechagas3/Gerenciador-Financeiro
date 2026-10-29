import { createBrowserClient } from '@supabase/ssr'

let browserClient: ReturnType<typeof createBrowserClient> | undefined

export function createClient() {
  browserClient ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        secure: window.location.protocol === 'https:',
        sameSite: window.location.protocol === 'https:' ? 'none' : 'lax',
      },
    },
  )
  return browserClient
}
