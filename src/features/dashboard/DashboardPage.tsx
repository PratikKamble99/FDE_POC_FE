import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { api } from '@/lib/api'
import type { Dashboard, DashboardRow } from '@/lib/types'
import { useAuth } from '@/features/auth/AuthProvider'
import { StateBadge, StateLegend } from '@/components/StateBadge'
import { ErrorState, Loading, EmptyState, PageTitle } from '@/components/states'
import { UploadDialog } from '@/features/documents/UploadDialog'
import { Button } from '@/components/ui/button'
import { credentialLabel, formatDate, titleize } from '@/lib/format'

export function useDashboard(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ['dashboard', orgId],
    enabled: !!orgId,
    queryFn: async () => (await api.get<Dashboard>(`/orgs/${orgId}/dashboard`)).data,
  })
}

export function DashboardPage() {
  const { account } = useAuth()
  const { data, isPending, error } = useDashboard(account?.org_id)
  const [uploadOpen, setUploadOpen] = useState(false)

  if (isPending) return <Loading label="Evaluating the roster…" />
  if (error) return <ErrorState error={error} />

  const { totals, counts_by_state, clinicians, evaluated_on } = data

  return (
    <>
      <PageTitle
        title="Compliance roster"
        subtitle={
          <>
            {totals.non_compliant} of {totals.clinicians}{' '}
            {totals.clinicians === 1 ? 'clinician has' : 'clinicians have'} an open gap · evaluated{' '}
            {formatDate(evaluated_on)}
          </>
        }
        actions={
          <Button onClick={() => setUploadOpen(true)}>Upload a document</Button>
        }
      />

      <StateLegend counts={counts_by_state} />

      {clinicians.length === 0 ? (
        <EmptyState title="No clinicians yet">
          Add clinicians on the <Link className="text-notary underline" to="/team">Team</Link> page
          to start tracking their credentials.
        </EmptyState>
      ) : (
        <div className="mt-6 overflow-x-auto border border-rule bg-surface">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                {['Clinician', 'Clinical role', 'Jurisdiction', 'Requirements', 'Open gaps'].map(
                  (heading) => (
                    <th
                      key={heading}
                      className="px-4 py-2.5 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-slate"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {clinicians.map((row) => (
                <RosterRow key={row.clinician_id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        clinicians={clinicians.map((c) => ({ id: c.clinician_id, full_name: c.full_name }))}
      />
    </>
  )
}

function RosterRow({ row }: { row: DashboardRow }) {
  const { summary } = row
  return (
    <tr className="border-b border-rule last:border-b-0 hover:bg-paper/60">
      <td className="px-4 py-3">
        <Link
          to={`/clinicians/${row.clinician_id}`}
          className="font-medium text-ink underline-offset-2 hover:text-notary hover:underline"
        >
          {row.full_name}
        </Link>
      </td>
      <td className="px-4 py-3 text-slate">{titleize(row.role)}</td>
      <td className="px-4 py-3 font-mono text-xs text-slate">{row.jurisdiction ?? '—'}</td>
      <td className="px-4 py-3 font-mono tabular-nums text-slate">{summary.total_requirements}</td>
      <td className="px-4 py-3">
        {/* `gaps[]` ships with the roster precisely so the reason a clinician is
            red renders here without a second request per row. */}
        {summary.compliant ? (
          <StateBadge state="satisfied" />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {summary.gaps.map((gap) => (
              <span
                key={`${gap.credential_type}-${gap.state}`}
                className="inline-flex items-center gap-1.5"
              >
                <StateBadge state={gap.state} />
                <span className="text-xs text-slate">{credentialLabel(gap.credential_type)}</span>
              </span>
            ))}
          </div>
        )}
      </td>
    </tr>
  )
}
