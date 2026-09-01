import type { ReactNode } from 'react'
import { Label } from './label'

/** Label + control + error, the arrangement every RHF field in this app uses. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-slate">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-state-expired">
          {error}
        </p>
      )}
    </div>
  )
}
