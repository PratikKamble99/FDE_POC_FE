import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { api } from '@/lib/api'
import type { ReviewQueue } from '@/lib/types'
import { ErrorState, Loading, EmptyState, PageTitle } from '@/components/states'
import { Button } from '@/components/ui/button'
import { ReviewControls } from './ReviewControls'
import { credentialLabel, formatDateTime, percent, titleize } from '@/lib/format'

const PAGE = 50

/**
 * The work queue for checks the pipeline could not decide.
 *
 * Oldest first, because the clinician stuck longest is the one to unstick: a
 * pending check holds an otherwise-satisfied requirement at `pending`, and
 * `compliant` is strict, so nobody with one outstanding can be compliant.
 */
export function ReviewQueuePage() {
  const [offset, setOffset] = useState(0)

  const { data, isPending, error, isFetching } = useQuery({
    queryKey: ['review-queue', offset],
    queryFn: async () =>
      (await api.get<ReviewQueue>('/document-checks/review-queue', { params: { limit: PAGE, offset } }))
        .data,
  })

  if (isPending) return <Loading label="Loading the review queue…" />
  if (error) return <ErrorState error={error} />

  return (
    <>
      <PageTitle
        title="Needs review"
        subtitle="Checks the pipeline would not guess at. Low confidence escalates here rather than passing as verified."
      />

      {data.checks.length === 0 ? (
        <EmptyState title="Nothing is waiting on a human">
          Every check has either passed on its own or been decided. New escalations appear here as
          documents are read.
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {data.checks.map((check) => (
            <article
              key={check.id}
              className="grid gap-3 border border-rule bg-surface p-4 sm:grid-cols-[1fr_auto] sm:items-start"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h2 className="font-display text-lg text-ink">{titleize(check.check_type)}</h2>
                  <span className="text-sm text-slate">
                    on {credentialLabel(check.credential_type).toLowerCase()} for
                  </span>
                  <Link
                    to={`/clinicians/${check.clinician_id}`}
                    className="font-medium text-notary underline-offset-2 hover:underline"
                  >
                    {check.clinician_name}
                  </Link>
                  <span className="text-sm text-slate">({titleize(check.clinician_role)})</span>
                </div>

                <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate">
                  <span>
                    Confidence <span className="font-mono text-ink">{percent(check.confidence)}</span>
                  </span>
                  {check.model && (
                    <span>
                      Read by <span className="font-mono text-ink">{check.model}</span>
                    </span>
                  )}
                  <span>Escalated {formatDateTime(check.created_at)}</span>
                </p>

                <Link
                  to={`/documents/${check.credential_document_id}`}
                  className="mt-2 inline-block text-sm text-notary underline-offset-2 hover:underline"
                >
                  Open the document to see what was read
                </Link>
              </div>

              <ReviewControls checkId={check.id} />
            </article>
          ))}
        </div>
      )}

      {(offset > 0 || data.has_more) && (
        <div className="mt-6 flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0 || isFetching}
            onClick={() => setOffset((current) => Math.max(current - PAGE, 0))}
          >
            Newer
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!data.has_more || isFetching}
            onClick={() => setOffset((current) => current + PAGE)}
          >
            Older
          </Button>
          <span className="text-xs text-slate">
            {offset + 1}–{offset + data.checks.length}
          </span>
        </div>
      )}
    </>
  )
}
