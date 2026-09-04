import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import type { ReportList, ReportSummary } from '@/lib/types'
import { useAuth } from '@/features/auth/AuthProvider'
import { hasScope } from '@/lib/scopes'
import { EmptyState, ErrorState, Loading, PageTitle } from '@/components/states'
import { STATUS_STYLE } from './ReportPage'
import { formatDate, titleize } from '@/lib/format'
import { cn } from '@/lib/cn'

/** The list carries no body, so a row is named by its scope, not its heading. */
const title = (report: ReportSummary) =>
  report.scope === 'clinician' ? 'Clinician report' : 'Organization report'

/**
 * Every report this login may read, newest first.
 *
 * `GET /reports` is tenant-filtered by the server, and a clinician is pinned to
 * their own reports there — so this is the whole org's queue for an officer and
 * the clinician's own record for them, no client-side bookkeeping either way.
 */
export function ReportsPage() {
  const { account } = useAuth()
  const canApprove = hasScope(account?.role, 'compliance:report')

  const { data, isPending, error } = useQuery({
    queryKey: ['reports'],
    queryFn: async () => (await api.get<ReportList>('/reports')).data,
  })

  if (isPending) return <Loading label="Loading reports…" />
  if (error) return <ErrorState error={error} />

  const reports = data.reports
  const waiting = reports.filter((r) => r.status === 'pending_approval').length

  return (
    <>
      <PageTitle
        title="Reports"
        subtitle={
          canApprove
            ? `Drafted reports wait here for a person to sign them off.${waiting ? ` ${waiting} waiting on you.` : ''}`
            : 'Point-in-time compliance records. Approving one is a compliance officer’s call, not a reader’s.'
        }
      />

      {reports.length === 0 ? (
        <EmptyState title="No reports yet">
          Reports are drafted by an upload that leaves a gap open, or by asking for one in{' '}
          <Link to="/chat" className="text-notary underline-offset-2 hover:underline">
            Ask
          </Link>
          .
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {reports.map((report) => (
            <Link
              key={report.id}
              to={`/reports/${report.id}`}
              className="flex flex-wrap items-center justify-between gap-3 border border-rule bg-surface p-4 transition-colors hover:border-notary"
            >
              <span className="min-w-0">
                <span className="block font-display text-lg text-ink">{title(report)}</span>
                <span className="text-xs text-slate">{formatDate(report.created_at)}</span>
              </span>
              <span
                className={cn(
                  'inline-flex items-center border px-2 py-0.5 text-[0.6875rem] font-medium uppercase tracking-[0.06em]',
                  STATUS_STYLE[report.status] ?? STATUS_STYLE.draft,
                )}
              >
                {titleize(report.status)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
