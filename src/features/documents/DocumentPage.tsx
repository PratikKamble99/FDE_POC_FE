import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import type { DocumentDetail } from '@/lib/types'
import { ErrorState, Loading, PageTitle } from '@/components/states'
import { Button } from '@/components/ui/button'
import { ReviewControls } from '@/features/reviews/ReviewControls'
import { useAuth } from '@/features/auth/AuthProvider'
import { hasScope } from '@/lib/scopes'
import { credentialLabel, formatDate, percent, titleize } from '@/lib/format'
import { cn } from '@/lib/cn'

export function DocumentPage() {
  const { documentId } = useParams()
  const { account } = useAuth()
  const { data, isPending, error } = useQuery({
    queryKey: ['document', documentId],
    queryFn: async () => (await api.get<DocumentDetail>(`/documents/${documentId}`)).data,
  })

  if (isPending) return <Loading label="Loading the document…" />
  if (error) return <ErrorState error={error} />

  const pendingReview = data.checks.filter((c) => c.review_status === 'pending')
  const canReview = hasScope(account?.role, 'documents:update')

  return (
    <>
      <PageTitle
        title={credentialLabel(data.credential_type)}
        subtitle={
          <>
            {titleize(data.document_type)} · {titleize(data.status)}
            {data.ocr?.confidence != null && ` · OCR confidence ${percent(data.ocr.confidence)}`}
          </>
        }
        actions={
          data.credential && (
            <Button asChild variant="outline">
              <Link to={`/credentials/${data.credential.id}`}>Open the credential</Link>
            </Button>
          )
        }
      />

      {/* Actionable where the reviewer already is. The queue at /reviews is the
          same work across the org; this is the one document in front of you. */}
      {pendingReview.length > 0 && (
        <section className="mb-8 border-l-2 border-state-expiring_soon bg-surface p-4">
          <h2 className="font-display text-lg text-ink">
            {pendingReview.length === 1
              ? 'One check needs your decision'
              : `${pendingReview.length} checks need your decision`}
          </h2>
          <p className="mt-1 text-sm text-slate">
            The credential was still created and still went on for verification. But a pending check
            holds the requirement at <em>pending</em> rather than <em>satisfied</em>, and
            &ldquo;compliant&rdquo; is strict — so this clinician cannot be compliant until{' '}
            {pendingReview.length === 1 ? 'it is' : 'they are'} decided.
          </p>

          <div className="mt-4 grid gap-4">
            {pendingReview.map((check) => (
              <div key={check.id} className="grid gap-2 border-t border-rule pt-4">
                <p className="text-sm text-ink">
                  {titleize(check.check_type)}
                  <span className="ml-2 font-mono text-xs text-slate">
                    confidence {percent(check.confidence)}
                  </span>
                </p>
                {canReview ? (
                  <ReviewControls checkId={check.id} />
                ) : (
                  <p className="text-xs text-slate">
                    Someone with document permissions has to decide this one.
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-display text-xl text-ink">What the document says</h2>
        {data.ocr?.extracted_fields ? (
          <dl className="grid gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(data.ocr.extracted_fields).map(([field, value]) => (
              <div key={field} className="bg-surface p-3">
                <dt className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-slate">
                  {titleize(field)}
                </dt>
                <dd className="mt-1 break-words font-mono text-sm text-ink">
                  {value == null || value === '' ? '—' : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="border border-dashed border-rule bg-surface p-6 text-center text-sm text-slate">
            Nothing has been extracted from this document yet.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-3 font-display text-xl text-ink">Checks</h2>
        <div className="overflow-x-auto border border-rule bg-surface">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule text-left">
                {['Check', 'Result', 'Confidence', 'Review'].map((heading) => (
                  <th
                    key={heading}
                    className="px-4 py-2.5 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-slate"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.checks.map((check) => (
                <tr key={check.id} className="border-b border-rule last:border-b-0">
                  <td className="px-4 py-2.5 text-ink">{titleize(check.check_type)}</td>
                  <td
                    className={cn(
                      'px-4 py-2.5',
                      check.passed === true && 'text-state-satisfied',
                      check.passed === false && 'text-state-expired',
                      check.passed === null && 'text-slate',
                    )}
                  >
                    {/* `passed` is nullable on purpose: null with a pending
                        review means nobody has decided, which is not "failed". */}
                    {check.passed === null ? 'Not decided' : check.passed ? 'Passed' : 'Failed'}
                  </td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-slate">
                    {percent(check.confidence)}
                  </td>
                  <td className="px-4 py-2.5 text-slate">{titleize(check.review_status)}</td>
                </tr>
              ))}
              {data.checks.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate">
                    No checks were raised.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {data.credential && (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-xl text-ink">The drafted credential</h2>
          <dl className="grid gap-px border border-rule bg-rule sm:grid-cols-3">
            {[
              ['Holder', data.credential.holder_name],
              ['Identifier', data.credential.identifier],
              ['Jurisdiction', data.credential.jurisdiction],
              ['Issued', formatDate(data.credential.issued_on)],
              ['Expires (printed)', formatDate(data.credential.expires_on)],
              ['Expires (effective)', formatDate(data.credential.effective_expires_on)],
            ].map(([term, value]) => (
              <div key={term} className="bg-surface p-3">
                <dt className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-slate">
                  {term}
                </dt>
                <dd className="mt-1 font-mono text-sm text-ink">{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  )
}
