import { COMPLIANCE_STATES, type ComplianceState } from '@/lib/types'
import { cn } from '@/lib/cn'

/** Six states, six colours. `pending` deliberately shares the chrome's neutral
 *  slate — "wait" is not an alarm — and `rejected` is aubergine rather than red
 *  because it sends a compliance officer somewhere different from `expired`. */
const STATE_STYLE: Record<ComplianceState, string> = {
  satisfied: 'border-state-satisfied/30 bg-state-satisfied/8 text-state-satisfied',
  pending: 'border-state-pending/30 bg-state-pending/8 text-state-pending',
  missing: 'border-state-missing/30 bg-state-missing/8 text-state-missing',
  expiring_soon: 'border-state-expiring_soon/30 bg-state-expiring_soon/8 text-state-expiring_soon',
  expired: 'border-state-expired/30 bg-state-expired/8 text-state-expired',
  rejected: 'border-state-rejected/30 bg-state-rejected/8 text-state-rejected',
}

export const STATE_LABEL: Record<ComplianceState, string> = {
  satisfied: 'Satisfied',
  pending: 'Pending',
  missing: 'Missing',
  expiring_soon: 'Expiring soon',
  expired: 'Expired',
  rejected: 'Rejected',
}

/** What HR does about it. From docs/AGENTS.md §4 step 3 — the reason each state
 *  exists is that it maps to a different action. */
export const STATE_ACTION: Record<ComplianceState, string> = {
  satisfied: 'Nothing to do',
  pending: 'Wait',
  missing: 'Chase for upload',
  expiring_soon: 'Chase for renewal',
  expired: 'Urgent — block',
  rejected: 'Investigate',
}

export function StateBadge({
  state,
  className,
}: {
  state: ComplianceState
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center border px-2 py-0.5 text-[0.6875rem] font-medium uppercase tracking-[0.06em]',
        STATE_STYLE[state] ?? STATE_STYLE.pending,
        className,
      )}
    >
      {STATE_LABEL[state] ?? state}
    </span>
  )
}

/** The fixed legend. It carries `counts_by_state` straight from the API, and it
 *  is the one place the six states are all visible at once — which is what makes
 *  the badges elsewhere readable without a key. */
export function StateLegend({ counts }: { counts: Record<string, number> }) {
  return (
    <dl className="grid grid-cols-2 border border-rule bg-surface sm:grid-cols-3 lg:grid-cols-6">
      {COMPLIANCE_STATES.map((state) => (
        <div key={state} className="border-b border-r border-rule p-3 last:border-r-0">
          <dt className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2 shrink-0"
              style={{ background: `var(--color-state-${state})` }}
            />
            <span className="text-[0.6875rem] font-medium uppercase tracking-[0.06em] text-slate">
              {STATE_LABEL[state]}
            </span>
          </dt>
          <dd className="mt-1 font-mono text-2xl tabular-nums text-ink">{counts[state] ?? 0}</dd>
          <dd className="text-xs text-slate">{STATE_ACTION[state]}</dd>
        </div>
      ))}
    </dl>
  )
}
