import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth, homeFor } from './AuthProvider'
import type { PlatformRole } from '@/lib/types'

/** Signed in, and optionally holding one of `roles`.
 *
 *  This is convenience, not security — the API enforces RBAC on every route
 *  regardless. Its job is to keep someone from landing on a screen that can only
 *  answer 403. */
export function RequireAuth({ roles }: { roles?: PlatformRole[] }) {
  const { account } = useAuth()
  const location = useLocation()

  if (!account) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (roles && !roles.includes(account.role)) return <Navigate to={homeFor(account)} replace />
  return <Outlet />
}
