import { createClient } from '@/lib/supabase/server'

export class FinancePersistenceDisabledError extends Error {
  constructor() {
    super('Persistência financeira bloqueada: falta autorização server-side e políticas de propriedade por usuário.')
    this.name = 'FinancePersistenceDisabledError'
  }
}

export async function getFinanceAuthContext() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return { supabase, user: null }
  return { supabase, user: data.user }
}

export async function createFinanceServerRepository() {
  const context = await getFinanceAuthContext()

  return {
    user: context.user,
    async listAccounts() {
      throw new FinancePersistenceDisabledError()
    },
    async listCategories() {
      throw new FinancePersistenceDisabledError()
    },
    async listMovements() {
      throw new FinancePersistenceDisabledError()
    },
    async createAccount() {
      throw new FinancePersistenceDisabledError()
    },
    async createCategory() {
      throw new FinancePersistenceDisabledError()
    },
    async createMovement() {
      throw new FinancePersistenceDisabledError()
    },
  }
}
