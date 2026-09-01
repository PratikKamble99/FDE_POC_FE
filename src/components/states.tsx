import type { ReactNode } from 'react'
import { normalizeError } from '@/lib/api'

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="py-16 text-center text-sm text-slate">
      {label}
    </p>
  )
}

/** Errors explain what happened and what to do about it — they don't apologize
 *  and they aren't vague. A 403 is a different message from a 500. */
export function ErrorState({ error }: { error: unknown }) {
  const { status, message } = normalizeError(error)
  const guidance =
    status === 403
      ? 'Your role does not have access to this. Ask a compliance officer if you need it.'
      : status === 404
        ? 'It may have been removed, or the link may be wrong.'
        : status === 0
          ? 'Check that the API is running on port 8000, then try again.'
          : null

  return (
    <div className="border-l-2 border-state-expired bg-surface p-6">
      <p className="font-display text-lg text-ink">{message}</p>
      {guidance && <p className="mt-1 text-sm text-slate">{guidance}</p>}
    </div>
  )
}

/** An empty screen is an invitation to act, so it always names the next step. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border border-dashed border-rule bg-surface p-10 text-center">
      <p className="font-display text-lg text-ink">{title}</p>
      {children && <div className="mt-2 text-sm text-slate">{children}</div>}
    </div>
  )
}

export function PageTitle({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl leading-tight text-ink">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate">{subtitle}</div>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  )
}
