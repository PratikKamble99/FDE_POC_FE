/** How a column value is written in a sentence a human reads. Mirrors
 *  `_TYPE_LABEL` in app/d3_agents/agents/compliance/agent.py. */
const CREDENTIAL_LABELS: Record<string, string> = {
  rn_license: 'RN license',
  md_license: 'MD license',
  dea_registration: 'DEA registration',
  bls: 'BLS certification',
  acls: 'ACLS certification',
  hipaa_training: 'HIPAA training',
  vaccination: 'Vaccination record',
  other: 'Credential',
}

/** Fallback for anything this build doesn't know: a loose label beats a blank
 *  cell, and `rn_license` in prose reads like a database leaked into the UI. */
export function titleize(value: string | null | undefined): string {
  if (!value) return '—'
  return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

export function credentialLabel(type: string | null | undefined): string {
  if (!type) return 'Identity document'
  return CREDENTIAL_LABELS[type] ?? titleize(type)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function percent(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}
