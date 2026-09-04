import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { api, normalizeError } from '@/lib/api'
import type { Credential } from '@/lib/types'
import { VerificationLedger, ledgerFromCredential } from '@/components/VerificationLedger'
import { ErrorState, Loading, PageTitle } from '@/components/states'
import { Button } from '@/components/ui/button'
import { PipelineStepper } from '@/features/documents/PipelineStepper'
import { credentialLabel, formatDate, formatDateTime, titleize } from '@/lib/format'
import { cn } from '@/lib/cn'

/** `/credentials/{id}/reverify` answers a finished credential inline when
 *  INLINE_TASKS is on, and a job id when Celery has it. Both are real. */
type ReverifyResponse = { job_id: string } & Partial<Credential> & { status?: string }

export function CredentialPage() {
  const { credentialId } = useParams()
  const queryClient = useQueryClient()
  const [jobId, setJobId] = useState<string | null>(null)

  const { data, isPending, error } = useQuery({
    queryKey: ['credential', credentialId],
    queryFn: async () => (await api.get<Credential>(`/credentials/${credentialId}`)).data,
  })

  const reverify = useMutation({
    mutationFn: async () =>
      (await api.post<ReverifyResponse>(`/credentials/${credentialId}/reverify`)).data,
    onSuccess: (response) => {
      if (response.status === 'verifying') {
        setJobId(response.job_id)
      } else {
        // Inline mode already finished; the response carries the new state.
        queryClient.invalidateQueries({ queryKey: ['credential', credentialId] })
        toast.success('The authority has been checked again.')
      }
    },
    onError: (err) => toast.error(normalizeError(err).message),
  })

  if (isPending) return <Loading label="Loading the credential…" />
  if (error) return <ErrorState error={error} />

  // Append-only: re-verification adds rows rather than replacing them, so the
  // latest judgment is the last one written.
  const latest = data.verifications.at(-1)
  const mismatchFields = latest?.mismatches?.fields ?? []
  const policy = latest?.mismatches?.policy
  const superseded = data.status === 'superseded'

  return (
    <>
      <PageTitle
        title={credentialLabel(data.credential_type)}
        subtitle={
          <>
            {data.holder_name ?? 'Unnamed holder'}
            {data.jurisdiction && ` · ${data.jurisdiction}`} ·{' '}
            <span className="font-mono">{data.identifier ?? 'no identifier'}</span>
          </>
        }
        actions={
          // No gate here on purpose. `reverify` declares no `require_scope`, and
          // both routes resolve the credential the same way — a clinician who
          // could not load this page could not reverify it either. Gating on
          // `credentials:verify` would hide the button from a clinician acting
          // on their own record, which the API expressly allows.
          <Button onClick={() => reverify.mutate()} disabled={reverify.isPending || superseded}>
            {reverify.isPending ? 'Checking…' : 'Check the authority again'}
          </Button>
        }
      />

      {superseded && (
        <p className="mb-6 border-l-2 border-state-pending bg-surface p-4 text-sm text-slate">
          A renewal has already replaced this credential, so it cannot be checked again. Open the
          renewal instead.
        </p>
      )}

      {jobId && (
        <div className="mb-6 border border-rule bg-surface p-4">
          <PipelineStepper
            jobId={jobId}
            onDone={() => {
              setJobId(null)
              queryClient.invalidateQueries({ queryKey: ['credential', credentialId] })
            }}
          />
        </div>
      )}

      {/* The three axes stay separate on purpose: they can legitimately
          disagree, and collapsing them is what loses the audit trail. */}
      <dl className="grid gap-px border border-rule bg-rule sm:grid-cols-3">
        <Axis
          term="What the board said"
          value={titleize(data.authority_status)}
          note={data.authority_checked_at ? `checked ${formatDateTime(data.authority_checked_at)}` : 'never checked'}
        />
        <Axis
          term="Whether they agreed"
          value={latest ? titleize(latest.outcome) : 'Not compared yet'}
          note={latest ? formatDateTime(latest.created_at) : undefined}
        />
        <Axis term="What we concluded" value={titleize(data.status)} emphasis />
      </dl>

      <section className="mt-8">
        <h2 className="mb-3 font-display text-xl text-ink">The comparison</h2>
        <VerificationLedger rows={ledgerFromCredential(data, mismatchFields)} />
        {latest?.mismatches?.narrative && (
          <p className="mt-3 border-l-2 border-rule pl-3 text-sm text-slate">
            {latest.mismatches.narrative}
          </p>
        )}
        {policy && Object.keys(policy).length > 0 && (
          <p className="mt-3 border-l-2 border-state-rejected pl-3 text-sm text-slate">
            The document and the board agree. Your organization's policy is what rejects it.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-1 font-display text-xl text-ink">Timeline</h2>
        <p className="mb-3 text-sm text-slate">
          Every check appends. Nothing here is overwritten, which is what makes a claim defensible
          months later.
        </p>
        <Timeline credential={data} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 font-display text-xl text-ink">Dates</h2>
        <dl className="grid gap-px border border-rule bg-rule sm:grid-cols-3">
          <Axis term="Issued" value={formatDate(data.issued_on)} />
          <Axis term="Expires (as printed)" value={formatDate(data.expires_on)} />
          <Axis
            term="Expires (effective)"
            value={formatDate(data.effective_expires_on)}
            note={
              data.expires_on !== data.effective_expires_on
                ? 'derived from the renewal interval on the matching requirement'
                : undefined
            }
          />
        </dl>
      </section>
    </>
  )
}

function Axis({
  term,
  value,
  note,
  emphasis,
}: {
  term: string
  value: string
  note?: string
  emphasis?: boolean
}) {
  return (
    <div className="bg-surface p-4">
      <dt className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-slate">{term}</dt>
      <dd className={cn('mt-1 text-ink', emphasis ? 'font-display text-2xl' : 'text-lg')}>{value}</dd>
      {note && <dd className="mt-0.5 text-xs text-slate">{note}</dd>}
    </div>
  )
}

interface Entry {
  at: string
  kind: 'evidence' | 'judgment'
  title: string
  note?: string
  degraded?: boolean
}

function Timeline({ credential }: { credential: Credential }) {
  const entries: Entry[] = [
    ...credential.external_verifications.map(
      (row): Entry => ({
        at: row.fetched_at,
        kind: 'evidence',
        title: `${titleize(row.source)} answered ${titleize(row.authority_status)}`,
        // When the canonical status reads `unchecked`, the board's verbatim word
        // is the only thing a human can act on.
        note:
          row.authority_status === 'unchecked' && row.authority_status_raw
            ? `Their word, verbatim: "${row.authority_status_raw}"`
            : undefined,
        degraded: row.degraded,
      }),
    ),
    ...credential.verifications.map(
      (row): Entry => ({
        at: row.created_at,
        kind: 'judgment',
        title: `Comparison: ${titleize(row.outcome)}`,
        note: row.mismatches?.narrative ?? undefined,
      }),
    ),
  ].sort((a, b) => a.at.localeCompare(b.at))

  if (entries.length === 0) {
    return (
      <p className="border border-dashed border-rule bg-surface p-6 text-center text-sm text-slate">
        Nothing has been checked yet.
      </p>
    )
  }

  return (
    <ol className="border-l-2 border-rule">
      {entries.map((entry, index) => (
        <li key={`${entry.kind}-${index}`} className="relative py-3 pl-5">
          <span
            aria-hidden
            className={cn(
              'absolute -left-[5px] top-5 size-2 rounded-full',
              entry.kind === 'evidence' ? 'bg-slate' : 'bg-notary',
            )}
          />
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
            {entry.title}
            {entry.degraded && (
              <span className="inline-flex items-center gap-1 text-xs text-state-expiring_soon">
                <AlertTriangle className="size-3.5" />
                degraded — no determination was reached
              </span>
            )}
          </p>
          {entry.note && <p className="mt-0.5 text-sm text-slate">{entry.note}</p>}
          <p className="mt-0.5 font-mono text-xs text-slate">{formatDateTime(entry.at)}</p>
        </li>
      ))}
    </ol>
  )
}
