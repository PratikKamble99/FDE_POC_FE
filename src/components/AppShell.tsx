import { NavLink, Outlet } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth, DASHBOARD_ROLES } from '@/features/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { titleize } from '@/lib/format'
import { cn } from '@/lib/cn'

export function AppShell() {
  const { account, signOut } = useAuth()
  if (!account) return null

  const canSeeOrg = DASHBOARD_ROLES.includes(account.role)
  const canProvision = ['hr', 'compliance_officer', 'admin'].includes(account.role)

  const links = [
    canSeeOrg && { to: '/', label: 'Roster', end: true },
    account.role === 'clinician' && { to: '/me', label: 'My record', end: true },
    // The orchestrator grounds every turn against an organization, so an
    // account without one has nothing to ask about — a super admin's org_id is
    // null by design.
    account.org_id && { to: '/chat', label: 'Ask', end: false },
    canProvision && { to: '/team', label: 'Team', end: false },
    canSeeOrg && { to: '/policies', label: 'Policies', end: false },
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
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
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
