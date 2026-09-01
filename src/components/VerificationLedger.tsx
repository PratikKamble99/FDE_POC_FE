import { AlertTriangle } from 'lucide-react'
import type { Credential, FieldMismatch } from '@/lib/types'
import { titleize } from '@/lib/format'
import { cn } from '@/lib/cn'

export interface LedgerRow {
  field: string
  document: string | null
  authority: string | null
  agrees: boolean
}

/**
 * The signature element: what the document says beside what the issuing
 * authority says, on one baseline.
 *
 * Values are monospaced because that is the whole point of the comparison — the
 * diff exists to surface a transposed digit (CA-88912 against CA-88921), and a
 * proportional face hides exactly that. Rows are marked at field granularity
 * because `mismatches[]` already names which field differs; a character-level
 * diff would be re-deriving what the API hands over.
 */
export function VerificationLedger({
  rows,
  className,
}: {
  rows: LedgerRow[]
  className?: string
}) {
  if (rows.length === 0) return null

  return (
    <div className={cn('overflow-x-auto border border-rule bg-surface', className)}>
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-rule text-left">
            <th className="w-1/4 px-3 py-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-slate">
              Field
            </th>
            <th className="px-3 py-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-slate">
              On the document
            </th>
            <th className="px-3 py-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-slate">
              At the authority
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.field}
              className={cn('border-b border-rule last:border-b-0', !row.agrees && 'bg-state-expired/5')}
            >
              <th scope="row" className="px-3 py-2 text-left font-normal text-slate">
                <span className="flex items-center gap-1.5">
                  {!row.agrees && (
                    <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-state-expired" />
                  )}
                  {titleize(row.field)}
                  {!row.agrees && <span className="sr-only">— differs</span>}
                </span>
              </th>
              <td className="px-3 py-2 font-mono text-ink">{row.document || '—'}</td>
              <td
                className={cn(
                  'px-3 py-2 font-mono',
                  row.agrees ? 'text-slate' : 'font-medium text-state-expired',
                )}
              >
                {row.authority || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Just the fields the authority disagreed with. Used where only the diff is on
 *  hand — a finding's `reason.mismatches`. */
export function ledgerFromMismatches(mismatches: FieldMismatch[]): LedgerRow[] {
  return mismatches.map((m) => ({
    field: m.field,
    document: m.document,
    authority: m.authority,
    agrees: false,
  }))
}

/** The four compared fields (docs/AGENTS.md §3, "The diff"), so the ones that
 *  agreed stay visible next to the one that didn't. Anything the authority did
 *  not disagree with is shown as matching. */
export function ledgerFromCredential(
  credential: Credential,
  mismatches: FieldMismatch[],
): LedgerRow[] {
  const differing = new Map(mismatches.map((m) => [m.field, m]))
  const compared: [string, string | null][] = [
    ['holder_name', credential.holder_name],
    ['identifier', credential.identifier],
    ['jurisdiction', credential.jurisdiction],
    ['expires_on', credential.expires_on],
  ]

  return compared.map(([field, document]) => {
    const mismatch = differing.get(field)
    return mismatch
      ? { field, document: mismatch.document ?? document, authority: mismatch.authority, agrees: false }
      : { field, document, authority: document, agrees: true }
  })
}
