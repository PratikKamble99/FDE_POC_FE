import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useState } from 'react'
import { api } from '@/lib/api'
import type { ClinicianCompliance, Finding } from '@/lib/types'
import { useAuth } from '@/features/auth/AuthProvider'
import { StateBadge, STATE_ACTION } from '@/components/StateBadge'
import { VerificationLedger, ledgerFromMismatches } from '@/components/VerificationLedger'
import { ErrorState, Loading, EmptyState, PageTitle } from '@/components/states'
import { UploadDialog } from '@/features/documents/UploadDialog'
import { Button } from '@/components/ui/button'
import { credentialLabel, formatDate, titleize } from '@/lib/format'

function useCompliance(clinicianId: string | null | undefined) {
  return useQuery({
    queryKey: ['compliance', clinicianId],
    enabled: !!clinicianId,
    queryFn: async () =>
      (await api.get<ClinicianCompliance>(`/clinicians/${clinicianId}/compliance-status`)).data,
  })
}

/** A clinician login has no roster to arrive from, so their own record is a
 *  route of its own rather than a link they could not have followed. */
export function MyRecordPage() {
  const { account } = useAuth()
  if (!account?.clinician_id) {
    return (
      <EmptyState title="No clinician record is linked to this login">
        Ask HR to link your account to your clinician record.
      </EmptyState>
    )
  }
  return <ClinicianView clinicianId={account.clinician_id} />
}

export function ClinicianPage() {
  const { clinicianId } = useParams()
  return <ClinicianView clinicianId={clinicianId!} />
}

function ClinicianView({ clinicianId }: { clinicianId: string }) {
  const { data, isPending, error } = useCompliance(clinicianId)
  const [uploadOpen, setUploadOpen] = useState(false)

  if (isPending) return <Loading label="Evaluating against active policy…" />
  if (error) return <ErrorState error={error} />

  const { clinician, findings, summary, evaluated_on } = data
  const ordered = [...findings].sort(
    (a, b) => rank(a) - rank(b) || Number(b.is_mandatory) - Number(a.is_mandatory),
  )

  return (
    <>
      <PageTitle
        title={clinician.full_name}
        subtitle={
          <>
            {titleize(clinician.role)}
            {clinician.jurisdiction && ` · ${clinician.jurisdiction}`} ·{' '}
            {summary.compliant
              ? 'meets every mandatory requirement'
              : `${summary.mandatory_gaps} mandatory ${summary.mandatory_gaps === 1 ? 'gap' : 'gaps'}`}{' '}
            · evaluated {formatDate(evaluated_on)}
          </>
        }
        actions={<Button onClick={() => setUploadOpen(true)}>Upload a document</Button>}
      />

      {ordered.length === 0 ? (
        <EmptyState title="No requirements apply to this clinician">
          Requirements come from approved policy for their clinical role and jurisdiction. If this
          looks wrong, check that policy rules have been approved for your organization.
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {ordered.map((finding) => (
            <FindingCard key={finding.requirement_id} finding={finding} />
          ))}
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        clinicians={[{ id: clinician.id, full_name: clinician.full_name }]}
        lockedClinicianId={clinician.id}
      />
    </>
  )
}

/** Worst first — what needs action leads. */
const ORDER = ['expired', 'rejected', 'missing', 'expiring_soon', 'pending', 'satisfied']
const rank = (f: Finding) => ORDER.indexOf(f.state)

function FindingCard({ finding }: { finding: Finding }) {
  const { reason } = finding
  const mismatches = reason.mismatches ?? []
  const isPolicyRejection = reason.code === 'policy_rejected'

  return (
    <article className="border border-rule bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StateBadge state={finding.state} />
            <h2 className="font-display text-lg text-ink">
              {credentialLabel(finding.credential_type)}
            </h2>
            {!finding.is_mandatory && (
              <span className="text-[0.6875rem] uppercase tracking-[0.06em] text-slate">
                Recommended
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-ink">{reason.detail}</p>
          <p className="mt-0.5 text-xs text-slate">
            {STATE_ACTION[finding.state]} ·{' '}
            <span className="font-mono">{reason.code}</span>
          </p>
        </div>

        {finding.credential_id && (
          <Button asChild variant="outline" size="sm">
            <Link to={`/credentials/${finding.credential_id}`}>Open credential</Link>
          </Button>
        )}
      </div>

      {(mismatches.length > 0 || isPolicyRejection) && (
        <details className="border-t border-rule">
          <summary className="cursor-pointer px-4 py-2 text-xs text-notary hover:bg-notary-soft">
            {isPolicyRejection ? 'Why policy rejected it' : 'What the authority disagreed with'}
          </summary>
          <div className="grid gap-3 p-4 pt-0">
            {mismatches.length > 0 && <VerificationLedger rows={ledgerFromMismatches(mismatches)} />}
            {reason.narrative && <p className="text-sm text-slate">{reason.narrative}</p>}
            {isPolicyRejection && (
              <p className="text-sm text-slate">
                The authority reports this credential as{' '}
                <span className="font-mono text-ink">{reason.authority_status_raw ?? 'unknown'}</span>
                . Your organization's policy does not accept{' '}
                <span className="font-mono text-ink">
                  {(reason.disallowed ?? []).join(', ') || '—'}
                </span>
                .
              </p>
            )}
          </div>
        </details>
      )}

      {/* The citation is copied from the requirement row a compliance officer
          personally approved — never regenerated. It sits beside the claim it
          backs, which is the whole "no uncited compliance claim" guarantee. */}
      {finding.citation_text && (
        <div className="border-t border-rule bg-paper/50 p-4">
          <p className="rail">
            <span className="block font-medium uppercase tracking-[0.08em]">Policy</span>
            {finding.citation_text}
          </p>
        </div>
      )}
    </article>
  )
}
