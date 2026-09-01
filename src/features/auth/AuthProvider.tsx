import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, setSessionLostHandler } from '@/lib/api'
import type { Account, PlatformRole } from '@/lib/types'

const STORAGE_KEY = 'fde.account'

interface AuthValue {
  account: Account | null
  signIn: (email: string, password: string) => Promise<Account>
  signOut: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

function readStored(): Account | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Account) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Only the account summary is persisted. The tokens stay in the httpOnly
  // cookies the API set — putting them in storage would hand them to any script
  // on the page for no gain, since the browser already sends them.
  const [account, setAccount] = useState<Account | null>(readStored)

  const signOut = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY)
    setAccount(null)
  }, [])

  useEffect(() => {
    setSessionLostHandler(signOut)
  }, [signOut])

  const signIn = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<{ account: Account }>('/auth/login', { email, password })
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data.account))
    setAccount(data.account)
    return data.account
  }, [])

  const value = useMemo(() => ({ account, signIn, signOut }), [account, signIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}

/** Where a role lands after signing in.
 *
 *  `super_admin` has `org_id: null` and is excluded from `_DASHBOARD_ROLES` in
 *  app/api/routes/orgs.py, so onboarding is genuinely their only screen. A
 *  `clinician` gets 403 from the dashboard by design and reads their own record
 *  instead. */
export function homeFor(account: Account): string {
  if (account.role === 'super_admin') return '/admin/organizations/new'
  if (account.role === 'clinician') return '/me'
  return '/'
}

export const DASHBOARD_ROLES: PlatformRole[] = ['hr', 'compliance_officer', 'admin']
