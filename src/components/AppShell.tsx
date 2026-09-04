import { NavLink, Outlet } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { DASHBOARD_ROLES, hasScope } from '@/lib/scopes'
import { Button } from '@/components/ui/button'
import { titleize } from '@/lib/format'
import { cn } from '@/lib/cn'

export function AppShell() {
  const { account, signOut } = useAuth()
  if (!account) return null

  const canSeeOrg = DASHBOARD_ROLES.includes(account.role)
  // `users:create` — admin and HR. A compliance officer no longer holds it, so
  // offering them the page would only produce a 403 at the first submit.
  const canProvision = hasScope(account.role, 'users:create')

  const links = [
    canSeeOrg && { to: '/', label: 'Roster', end: true },
    account.role === 'clinician' && { to: '/me', label: 'My record', end: true },
    // The orchestrator grounds every turn against an organization, so an
    // account without one has nothing to ask about — a super admin's org_id is
    // null by design.
    account.org_id && { to: '/chat', label: 'Ask', end: false },
    // A pending check holds a clinician out of compliance, so this queue is
    // work, not a report — it sits in the main nav rather than behind a page.
    hasScope(account.role, 'documents:update') && {
      to: '/reviews',
      label: 'Needs review',
      end: false,
    },
    // `compliance:read` is held by every role except super admin, who holds no
    // compliance scope at all — the one login for whom this tab is only a 403.
    hasScope(account.role, 'compliance:read') && {
      to: '/reports',
      label: 'Reports',
      // Not `end`: an open report keeps the tab lit, which is where it came from.
      end: false,
    },
    canProvision && { to: '/team', label: 'Team', end: false },
    // `compliance:report` — admin and compliance officer. HR reads compliance
    // legitimately and may not decide what the organization is measured against.
    hasScope(account.role, 'compliance:report') && {
      to: '/policies',
      label: 'Policies',
      end: false,
    },
    account.role === 'super_admin' && {
      to: '/admin/organizations/new',
      label: 'Onboard',
      end: false,
    },
  ].filter(Boolean) as { to: string; label: string; end: boolean }[]

  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-6 py-3">
          <span className="font-display text-lg font-semibold tracking-tight text-ink">
            Credential Registry
          </span>

          <nav className="flex flex-1 flex-wrap gap-1">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  cn(
                    'px-3 py-1.5 text-sm transition-colors',
                    isActive ? 'bg-notary-soft font-medium text-notary' : 'text-slate hover:text-ink',
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="text-right text-xs leading-tight text-slate">
              <span className="block text-ink">{account.name ?? account.email}</span>
              {titleize(account.role)}
            </span>
            {/* "on this device" is literal: there is no logout route, and the
                session cookies are httpOnly, so this clears local state only. */}
            <Button
              variant="ghost"
              size="icon"
              onClick={signOut}
              aria-label="Sign out on this device"
              title="Sign out on this device"
            >
              <LogOut />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
