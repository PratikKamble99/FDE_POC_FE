import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth, homeFor } from './AuthProvider'
import { hasScope } from '@/lib/scopes'
import type { PlatformRole } from '@/lib/types'

/**
 * Signed in, and holding either one of `roles` or `scope`.
 *
 * Both exist because the API gates both ways: most routes check a scope, but
 * `orgs.py` gates the dashboard on a role frozenset. Matching whichever the
 * server actually applies beats being internally consistent.
 *
 * This is convenience, never security — the API re-checks every request. Its
 * job is to keep someone off a screen that can only answer 403.
 */
export function RequireAuth({ roles, scope }: { roles?: PlatformRole[]; scope?: string }) {
  const { account } = useAuth()
  const location = useLocation()

  if (!account) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (roles && !roles.includes(account.role)) return <Navigate to={homeFor(account)} replace />
  if (scope && !hasScope(account.role, scope)) return <Navigate to={homeFor(account)} replace />
  return <Outlet />
}
