import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { api } from '@/lib/api'
import type { PolicyList, PolicySummary } from '@/lib/types'
import { EmptyState, ErrorState, Loading, PageTitle } from '@/components/states'
import { Button } from '@/components/ui/button'
import { PolicyUploadDialog } from './PolicyUploadDialog'
import { titleize } from '@/lib/format'
import { cn } from '@/lib/cn'

const STATUS_STYLE: Record<string, string> = {
  draft: 'border-state-missing text-state-missing',
  published: 'border-state-satisfied text-state-satisfied',
  superseded: 'border-rule text-slate',
}

/** The list carries no rules, so a row is described by what it is, not its counts. */
function subtitle(policy: PolicySummary) {
  if (policy.status === 'draft') return 'Awaiting review — a draft enforces nothing'
  return [policy.jurisdiction, policy.version && `v${policy.version}`].filter(Boolean).join(' · ') || 'Enforced'
}

/**
 * The policy corpus, newest first. Drafts included — reviewing one is the point.
 *
 * `GET /policies` is tenant-filtered by the server, and a document whose
 * `allowed_roles` excludes the caller is removed by the same predicate that
 * removes it from search — so this is everything this login may enforce against.
 */
export function PoliciesPage() {
  const [uploading, setUploading] = useState(false)

  const { data, isPending, error } = useQuery({
    queryKey: ['policies'],
    queryFn: async () => (await api.get<PolicyList>('/policies')).data,
  })

  const documents = data?.documents ?? []
  const drafts = documents.filter((doc) => doc.status === 'draft').length

  return (
    <>
      <PageTitle
        title="Policies"
        subtitle={
          drafts
            ? `${drafts} ${drafts === 1 ? 'policy is' : 'policies are'} waiting for review. A draft enforces nothing.`
            : 'A policy becomes enforceable one way: an officer accepts the rules extracted from it. Every compliance finding cites the text it came from.'
        }
        actions={<Button onClick={() => setUploading(true)}>Upload a policy</Button>}
      />

      {isPending ? (
        <Loading label="Loading policies…" />
      ) : error ? (
        <ErrorState error={error} />
      ) : documents.length === 0 ? (
        <EmptyState title="No policies yet">
          Uploading one splits it, embeds it and proposes credential rules for you to accept. Until
          you publish it, nothing it says is enforced.
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {documents.map((policy) => (
            <Link
              key={policy.id}
              to={`/policies/${policy.id}`}
              className="flex flex-wrap items-center justify-between gap-3 border border-rule bg-surface p-4 transition-colors hover:border-notary"
            >
              <span className="min-w-0">
                <span className="block font-display text-lg text-ink">{policy.title}</span>
                <span className="text-xs text-slate">{subtitle(policy)}</span>
              </span>
              <span
                className={cn(
                  'inline-flex items-center border px-2 py-0.5 text-[0.6875rem] font-medium uppercase tracking-[0.06em]',
                  STATUS_STYLE[policy.status] ?? STATUS_STYLE.draft,
                )}
              >
                {titleize(policy.status)}
              </span>
            </Link>
          ))}
        </div>
      )}

      <PolicyUploadDialog open={uploading} onOpenChange={setUploading} />
    </>
  )
}
