import { randomUUID } from 'node:crypto'
import { validateEntryInput } from './validation'
import type { FinancialEntry } from './domain'

const EXPECTED_PROJECT_REF = 'iuamsqonrlpoztszdgdu'

export type ConnectionStatus = {
  configured: boolean
  hostname: string | null
  projectRef: string | null
  hostnameMatches: boolean
  writesEnabled: false
  reason: string
}

function getConfiguredUrl() {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
}

export function getConnectionStatus(): ConnectionStatus {
  const rawUrl = getConfiguredUrl()
  try {
    const url = new URL(rawUrl)
    const hostname = url.hostname
    const projectRef = hostname.endsWith('.supabase.co') ? hostname.split('.')[0] : null
    const hostnameMatches = projectRef === EXPECTED_PROJECT_REF
    return {
      configured: true,
      hostname,
      projectRef,
      hostnameMatches,
      writesEnabled: false,
      reason: hostnameMatches
        ? 'A identidade do hostname corresponde ao Project Reference esperado, mas o schema e as permissões ainda precisam ser verificados.'
        : 'O hostname configurado não corresponde ao Project Reference esperado.',
    }
  } catch {
    return {
      configured: false,
      hostname: null,
      projectRef: null,
      hostnameMatches: false,
      writesEnabled: false,
      reason: 'SUPABASE_URL não está configurada como uma URL válida.',
    }
  }
}

export function createFinanceRepository() {
  return {
    status: getConnectionStatus(),
    async listEntries(): Promise<FinancialEntry[]> {
      throw new Error('Leitura do banco está bloqueada até a identidade e o schema serem verificados.')
    },
    async createEntry(input: Record<string, unknown>) {
      validateEntryInput(input)
      throw new Error('Gravações financeiras estão desabilitadas até a autorização server-side ser verificada.')
    },
    newRequestId() {
      return randomUUID()
    },
  }
}
