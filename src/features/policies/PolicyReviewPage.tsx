import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { api, normalizeError } from '@/lib/api'
import {
  CLINICAL_ROLES,
  CREDENTIAL_TYPES,
  type PolicyReview,
  type ProposedRequirement,
  type PublishResult,
  type RequirementEdit,
} from '@/lib/types'
import { ErrorState, Loading, EmptyState, PageTitle } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PolicyUploadDialog } from './PolicyUploadDialog'
import { credentialLabel, percent, titleize } from '@/lib/format'
import { cn } from '@/lib/cn'

const CELL = 'h-8 w-full border border-rule bg-surface px-2 text-sm text-ink'

/**
 * One row's corrections, as `PublishPolicyRequest.edits` wants them.
 *
 * `statusRaw` is the disallowed-statuses cell as typed, `undefined` when it was
 * never touched. An absent key means "leave it alone" — the API reads edits with
 * `exclude_unset`, so an officer changing the renewal interval must not blank the
 * grace period by omission. A null `renewal_months` is dropped rather than sent:
 * the API's `exclude_none` discards it anyway, and a cleared cell that silently
 * does nothing should not look like a change here either.
 */
export function requirementEdit(edit: RequirementEdit, statusRaw: string | undefined): RequirementEdit {
  const next = { ...edit }
  if (statusRaw !== undefined) {
    next.disallowed_authority_statuses = statusRaw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  }
  if (next.renewal_months == null) delete next.renewal_months
  return next
}

/**
 * The officer's screen: every rule the extractor proposed, least-confident
 * first, with the policy's own words beside it.
 *
 * Publish is one action, not two. Ticked rows go active with this officer's
 * name on them, unticked rows go `rejected` — kept, not deleted, so what the
 * extractor proposed and a human refused stays visible for the next prompt
 * revision — and the document is published in the same transaction. There is no
 * state in which half a policy is live.
 */
export function PolicyReviewPage() {
  const { policyId = '' } = useParams()
  // Keyed, because publishing a new version navigates from this route to
  // itself: without a remount the previous policy's ticks and edits would be
  // held against a different document's rows, and publish would send ids that
  // are not this document's.
  return <Review key={policyId} policyId={policyId} />
}

function Review({ policyId }: { policyId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Set by an upload through `POST /policies/{id}/versions`; the review payload
  // does not carry the predecessor, and only a version may retire one.
  const replaces = (useLocation().state as { replaces?: string } | null)?.replaces

  const [ticked, setTicked] = useState<Set<string> | null>(null)
  const [edits, setEdits] = useState<Record<string, RequirementEdit>>({})
  // The disallowed-statuses cell is edited as raw text: re-splitting on every
  // keystroke would eat the comma the officer just typed.
  const [statusText, setStatusText] = useState<Record<string, string>>({})
  const [replaceExisting, setReplaceExisting] = useState(Boolean(replaces))
  const [newVersion, setNewVersion] = useState(false)

  const { data, isPending, error } = useQuery({
    queryKey: ['policy', policyId],
    queryFn: async () => (await api.get<PolicyReview>(`/policies/${policyId}/review`)).data,
  })

  const pending = (data?.requirements ?? []).filter((row) => row.status === 'pending')
  const accepted = ticked ?? new Set(pending.map((row) => row.id))
  const draft = data?.status === 'draft'

  const publish = useMutation({
    mutationFn: async () => {
      const accept = [...accepted]
      return (
        await api.post<PublishResult>(`/policies/${policyId}/publish`, {
          accept,
          // Edits on a row nobody accepted change nothing — the server applies
          // them only on the accept branch.
          edits: Object.fromEntries(
            accept
              .map((id) => [id, requirementEdit(edits[id] ?? {}, statusText[id])] as const)
              .filter(([, edit]) => Object.keys(edit).length),
          ),
          replace_existing: replaceExisting,
        })
      ).data
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['policy', policyId] })
      toast.success(
        `${result.activated} ${result.activated === 1 ? 'rule is' : 'rules are'} now enforced` +
          (result.rejected ? `, ${result.rejected} rejected.` : '.'),
      )
      if (result.replaced) toast('The policy this replaces was retired.')
    },
    onError: (error) => toast.error(normalizeError(error).message),
  })

  const retire = useMutation({
    mutationFn: async () =>
      (await api.delete<{ requirements_superseded: number }>(`/policies/${policyId}`)).data,
    onSuccess: (result) => {
      queryClient.invalidateQueries()
      toast.success(
        `Retired. ${result.requirements_superseded} ${
          result.requirements_superseded === 1 ? 'rule is' : 'rules are'
        } no longer enforced.`,
      )
    },
    onError: (error) => toast.error(normalizeError(error).message),
  })

  function setEdit(id: string, patch: RequirementEdit) {
    setEdits((current) => ({ ...current, [id]: { ...(current[id] ?? {}), ...patch } }))
  }

  function toggle(id: string) {
    setTicked((current) => {
      const next = new Set(current ?? accepted)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function value<K extends keyof ProposedRequirement & keyof RequirementEdit>(
    row: ProposedRequirement,
    key: K,
  ) {
    const edited = edits[row.id]?.[key]
    return edited === undefined ? row[key] : edited
  }

  if (isPending) return <Loading label="Loading the proposed rules…" />
  if (error) return <ErrorState error={error} />

  return (
    <>
      <PageTitle
        title={data.title}
        subtitle={
          draft
            ? 'A draft enforces nothing. Untick anything that is not a credential requirement — an issuing-authority statement is the usual one — and correct the cells the extractor cannot be trusted with.'
            : `${titleize(data.status)}. ${
                data.status === 'published'
                  ? 'Its accepted rules are what compliance measures this organization against.'
                  : 'Retired — its rules are no longer enforced, and its citations still resolve.'
              }`
        }
        actions={
          <>
            <Button variant="outline" onClick={() => navigate('/policies')}>
              All policies
            </Button>
            {data.status === 'published' && (
              <>
                <Button variant="outline" onClick={() => setNewVersion(true)}>
                  New version
                </Button>
                <Button
                  variant="danger"
                  disabled={retire.isPending}
                  onClick={() => {
                    if (confirm('Retire this policy? Its rules stop being enforced. Nothing is deleted.'))
                      retire.mutate()
                  }}
                >
                  Retire
                </Button>
              </>
            )}
          </>
        }
      />

      {data.requirements.length === 0 ? (
        <EmptyState title="This policy proposed no rules">
          Nothing in it read as a credential requirement. Publishing it is still legal and means
          exactly that — or upload a different document.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto border border-rule bg-surface">
          <table className="w-full min-w-5xl border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs uppercase tracking-[0.06em] text-slate">
                <th className="w-10 p-2" scope="col">
                  <span className="sr-only">Keep</span>
                </th>
                <th className="p-2 font-medium" scope="col">Credential</th>
                <th className="p-2 font-medium" scope="col">Role</th>
                <th className="p-2 font-medium" scope="col">Jurisdiction</th>
                <th className="p-2 font-medium" scope="col">Mandatory</th>
                <th className="p-2 font-medium" scope="col">Renewal (mo)</th>
                <th className="p-2 font-medium" scope="col">Grace (days)</th>
                <th className="p-2 font-medium" scope="col">Disallowed statuses</th>
                <th className="p-2 font-medium" scope="col">Cited text</th>
              </tr>
            </thead>
            <tbody>
              {data.requirements.map((row) => {
                const editable = draft && row.status === 'pending'
                const keep = accepted.has(row.id)
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      'border-b border-rule align-top last:border-b-0',
                      editable && !keep && 'opacity-45',
                    )}
                  >
                    <td className="p-2">
                      {editable ? (
                        <input
                          type="checkbox"
                          className="mt-1 size-4 accent-notary"
                          checked={keep}
                          onChange={() => toggle(row.id)}
                          aria-label={`Keep the ${credentialLabel(row.credential_type)} rule`}
                        />
                      ) : (
                        <span
                          className={cn(
                            'text-[0.6875rem] uppercase tracking-[0.06em]',
                            row.status === 'active' ? 'text-state-satisfied' : 'text-slate',
                          )}
                        >
                          {row.status === 'active' ? 'On' : 'Off'}
                        </span>
                      )}
                    </td>

                    <td className="p-2">
                      {editable ? (
                        <select
                          className={CELL}
                          value={value(row, 'credential_type')}
                          onChange={(event) => setEdit(row.id, { credential_type: event.target.value })}
                          aria-label="Credential"
                        >
                          {CREDENTIAL_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {credentialLabel(type)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        credentialLabel(row.credential_type)
                      )}
                      <p className="mt-1 text-xs text-slate">
                        Confidence {percent(row.extractor_confidence)}
                      </p>
                    </td>

                    <td className="p-2">
                      {editable ? (
                        <select
                          className={CELL}
                          value={value(row, 'role')}
                          onChange={(event) => setEdit(row.id, { role: event.target.value })}
                          aria-label="Role"
                        >
                          {CLINICAL_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {titleize(role)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        titleize(row.role)
                      )}
                    </td>

                    <td className="p-2">
                      {editable ? (
                        <Input
                          className="h-8 px-2"
                          value={value(row, 'jurisdiction') ?? ''}
                          onChange={(event) => setEdit(row.id, { jurisdiction: event.target.value })}
                          placeholder="Everywhere"
                          aria-label="Jurisdiction"
                        />
                      ) : (
                        (row.jurisdiction ?? '—')
                      )}
                    </td>

                    <td className="p-2">
                      {editable ? (
                        <input
                          type="checkbox"
                          className="mt-1 size-4 accent-notary"
                          checked={Boolean(value(row, 'is_mandatory'))}
                          onChange={(event) => setEdit(row.id, { is_mandatory: event.target.checked })}
                          aria-label="Mandatory"
                        />
                      ) : row.is_mandatory ? (
                        'Yes'
                      ) : (
                        'No'
                      )}
                    </td>

                    {/* The two cells that most need a human. `renewal_months` is
                        what an expiry is derived from when a card prints no date,
                        and a model asked for the interval hedges. */}
                    <td className="p-2">
                      {editable ? (
                        <Input
                          className="h-8 w-24 px-2"
                          type="number"
                          min={1}
                          max={120}
                          value={value(row, 'renewal_months') ?? ''}
                          onChange={(event) =>
                            setEdit(row.id, {
                              renewal_months: event.target.value ? Number(event.target.value) : null,
                            })
                          }
                          aria-label="Renewal months"
                        />
                      ) : (
                        (row.renewal_months ?? '—')
                      )}
                    </td>

                    <td className="p-2">
                      {editable ? (
                        <Input
                          className="h-8 w-24 px-2"
                          type="number"
                          min={0}
                          max={365}
                          value={value(row, 'grace_period_days') ?? ''}
                          onChange={(event) =>
                            setEdit(row.id, {
                              grace_period_days: event.target.value
                                ? Number(event.target.value)
                                : undefined,
                            })
                          }
                          aria-label="Grace period days"
                        />
                      ) : (
                        row.grace_period_days
                      )}
                    </td>

                    {/* Matched against the verbatim word an issuing board
                        returns, which is why it is free text and not our enum. */}
                    <td className="p-2">
                      {editable ? (
                        <Input
                          className="h-8 px-2"
                          value={statusText[row.id] ?? row.disallowed_authority_statuses.join(', ')}
                          onChange={(event) =>
                            setStatusText((current) => ({ ...current, [row.id]: event.target.value }))
                          }
                          placeholder="probationary, restricted"
                          aria-label="Disallowed authority statuses"
                        />
                      ) : (
                        (row.disallowed_authority_statuses.join(', ') || '—')
                      )}
                    </td>

                    <td className="max-w-md p-2">
                      <p className="rail">{row.citation_text ?? 'No citation — the extractor proposed this without one.'}</p>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button disabled={publish.isPending} onClick={() => publish.mutate()}>
            {publish.isPending ? 'Publishing…' : `Publish — keep ${accepted.size} of ${pending.length}`}
          </Button>

          {replaces && (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="size-4 accent-notary"
                checked={replaceExisting}
                onChange={(event) => setReplaceExisting(event.target.checked)}
              />
              Retire the policy this revises, in the same transaction
            </label>
          )}

          <p className="text-xs text-slate">
            Your name goes on every rule you keep. The rest are recorded as rejected, not deleted.
          </p>
        </div>
      )}

      <PolicyUploadDialog
        open={newVersion}
        onOpenChange={setNewVersion}
        supersedes={{ id: policyId, title: data.title }}
      />
    </>
  )
}
