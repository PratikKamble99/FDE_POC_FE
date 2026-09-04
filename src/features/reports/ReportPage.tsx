import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy } from 'lucide-react'
import { api, normalizeError } from '@/lib/api'
import type { Report } from '@/lib/types'
import { useAuth } from '@/features/auth/AuthProvider'
import { hasScope } from '@/lib/scopes'
import { ErrorState, Loading, PageTitle } from '@/components/states'
import { Button } from '@/components/ui/button'
import { titleize } from '@/lib/format'
import { cn } from '@/lib/cn'

export const STATUS_STYLE: Record<string, string> = {
  pending_approval: 'border-state-expiring_soon/30 bg-state-expiring_soon/8 text-state-expiring_soon',
  approved: 'border-state-satisfied/30 bg-state-satisfied/8 text-state-satisfied',
  sent: 'border-state-satisfied/30 bg-state-satisfied/8 text-state-satisfied',
  rejected: 'border-state-rejected/30 bg-state-rejected/8 text-state-rejected',
  draft: 'border-state-pending/30 bg-state-pending/8 text-state-pending',
}

export function ReportPage() {
  const { reportId } = useParams()
  const { account } = useAuth()
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)

  const { data, isPending, error } = useQuery({
    queryKey: ['report', reportId],
    queryFn: async () => (await api.get<Report>(`/reports/${reportId}`)).data,
  })

  const approve = useMutation({
    mutationFn: async () =>
      (await api.post<Report>(`/reports/${reportId}/approve`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report', reportId] })
      toast.success('Report approved. Nothing has been sent — delivery is not built yet.')
    },
    onError: (err) => {
      const { status, message } = normalizeError(err)
      // 409 is a state error, not a failure: the report moved on since this
      // page loaded. Say which state, not "something went wrong".
      toast.error(status === 409 ? `This report is ${data?.status ? titleize(data.status).toLowerCase() : 'no longer pending approval'}.` : message)
      if (status === 409) queryClient.invalidateQueries({ queryKey: ['report', reportId] })
    },
  })

  async function copyMarkdown() {
    // `GET /reports/{id}/download` is not built; format=markdown is the download.
    const { data: markdown } = await api.get<Report>(`/reports/${reportId}`, {
      params: { format: 'markdown' },
    })
    await navigator.clipboard.writeText(markdown.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (isPending) return <Loading label="Loading the report…" />
  if (error) return <ErrorState error={error} />

  const canApprove = hasScope(account?.role, 'compliance:report')
  const isPendingApproval = data.status === 'pending_approval'

  return (
    <div className="max-w-3xl">
      <PageTitle
        title={data.scope === 'clinician' ? 'Clinician report' : 'Organization report'}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center border px-2 py-0.5 text-[0.6875rem] font-medium uppercase tracking-[0.06em]',
                STATUS_STYLE[data.status] ?? STATUS_STYLE.draft,
              )}
            >
              {titleize(data.status)}
            </span>
            {data.clinician_id && (
              <Link
                to={`/clinicians/${data.clinician_id}`}
                className="text-notary underline-offset-2 hover:underline"
              >
                Open the clinician
              </Link>
            )}
          </span>
        }
        actions={
          <Button variant="outline" onClick={copyMarkdown}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy as Markdown'}
          </Button>
        }
      />

      {/* Rendered from the stored body, so it reads a year from now exactly as
          it did the day it was approved. Monospace because it is a record. */}
      <pre className="overflow-x-auto whitespace-pre-wrap break-words border border-rule bg-surface p-6 font-mono text-sm leading-relaxed text-ink">
        {data.text}
      </pre>

      {isPendingApproval && canApprove && (
        <section className="mt-6 border-l-2 border-state-expiring_soon bg-surface p-5">
          <h2 className="font-display text-lg text-ink">Approve this report</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate">
            Approving records your name against it as the person who signed it off. It does{' '}
            <strong className="font-medium text-ink">not</strong> send it — delivery to HR is a
            separate job that is not built yet, so nothing leaves the building today.
          </p>
          <Button
            className="mt-4"
            onClick={() => approve.mutate()}
            disabled={approve.isPending}
          >
            {approve.isPending ? 'Approving…' : 'Approve'}
          </Button>
        </section>
      )}

      {isPendingApproval && !canApprove && (
        <p className="mt-6 border-l-2 border-rule bg-surface p-5 text-sm text-slate">
          This report is waiting for approval. A compliance officer or an admin has to sign it off —
          reading compliance and releasing a report are deliberately different permissions.
        </p>
      )}

      {data.status === 'approved' && (
        <p className="mt-6 border-l-2 border-state-satisfied bg-surface p-5 text-sm text-slate">
          Signed off. Nothing has been posted to HR — the delivery job does not exist yet, so this is
          an approved record rather than a sent one.
        </p>
      )}
    </div>
  )
}
