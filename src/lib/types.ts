/** Mirrors of the API's response shapes. Only what the UI actually reads. */

// app/contracts/compliance.py — six states, each mapping to a different action.
// Never collapse two: `pending` is not `missing`, `rejected` is not `expired`.
export const COMPLIANCE_STATES = [
  'satisfied',
  'pending',
  'missing',
  'expiring_soon',
  'expired',
  'rejected',
] as const
export type ComplianceState = (typeof COMPLIANCE_STATES)[number]

// app/db/models/enums.py
export const CREDENTIAL_TYPES = [
  'rn_license',
  'md_license',
  'dea_registration',
  'bls',
  'acls',
  'hipaa_training',
  'vaccination',
  'other',
] as const
export type CredentialType = (typeof CREDENTIAL_TYPES)[number]

export const CLINICAL_ROLES = [
  'nurse',
  'physician',
  'technician',
  'therapist',
  'pharmacist',
  'other',
] as const

export type PlatformRole = 'clinician' | 'hr' | 'compliance_officer' | 'admin' | 'super_admin'

export interface Account {
  account_type: 'admin' | 'user'
  user_id: string
  email: string
  role: PlatformRole
  org_id: string | null
  name: string | null
  /** Not on LoginResponse — carried separately once known. */
  clinician_id?: string | null
}

// --- compliance -----------------------------------------------------------

export interface FieldMismatch {
  field: string
  document: string | null
  authority: string | null
}

/** `code` is the contract the UI branches on; `detail` is one sentence for a human. */
export interface FindingReason {
  code: string
  detail: string
  expires_on?: string | null
  days_until_expiry?: number | null
  grace_period_days?: number
  authority_status?: string | null
  authority_status_raw?: string | null
  disallowed?: string[]
  mismatches?: FieldMismatch[]
  narrative?: string | null
}

export interface Finding {
  requirement_id: string
  credential_type: string
  state: ComplianceState
  reason: FindingReason
  credential_id: string | null
  is_mandatory: boolean
  // Copied from the requirement row, never regenerated. This column copy is the
  // whole mechanism behind "no uncited compliance claim".
  citation_text: string | null
  source_chunk_id: string | null
  policy_document_id: string | null
}

export interface ComplianceSummary {
  compliant: boolean
  counts_by_state: Record<ComplianceState, number>
  mandatory_gaps: number
  gaps: { credential_type: string; state: ComplianceState; code: string }[]
  total_requirements: number
}

export interface ClinicianCompliance {
  clinician: { id: string; full_name: string; role: string; jurisdiction: string | null }
  findings: Finding[]
  summary: ComplianceSummary
  evaluated_on: string
}

export interface DashboardRow {
  clinician_id: string
  full_name: string
  role: string
  jurisdiction: string | null
  summary: ComplianceSummary
}

export interface Dashboard {
  organization_id: string
  clinicians: DashboardRow[]
  counts_by_state: Record<ComplianceState, number>
  totals: { clinicians: number; compliant: number; non_compliant: number }
  evaluated_on: string
}

// --- credentials ----------------------------------------------------------

export interface Credential {
  id: string
  credential_type: string
  status: string
  authority_status: string
  authority_checked_at: string | null
  identifier: string | null
  holder_name: string | null
  jurisdiction: string | null
  issued_on: string | null
  expires_on: string | null
  effective_expires_on: string | null
  verifications: {
    id: string
    outcome: string
    mismatches: { fields?: FieldMismatch[]; policy?: Record<string, unknown>; narrative?: string } | null
    created_at: string
  }[]
  external_verifications: {
    id: string
    source: string
    authority_status: string
    /** The board's own word, verbatim. What a human needs when the canonical
     *  status reads `unchecked`. */
    authority_status_raw: string | null
    degraded: boolean
    fetched_at: string
  }[]
}

// --- documents ------------------------------------------------------------

export interface DocumentDetail {
  id: string
  status: string
  document_type: string
  credential_type: string | null
  ocr: { extracted_fields: Record<string, unknown> | null; confidence: number | null; model: string | null } | null
  checks: {
    id: string
    check_type: string
    /** Nullable on purpose: `null` with review_status 'pending' means no human
     *  has decided yet, which is not the same as false. */
    passed: boolean | null
    confidence: number | null
    review_status: string
    details: Record<string, unknown> | null
  }[]
  credential: {
    id: string
    credential_type: string
    status: string
    identifier: string | null
    holder_name: string | null
    jurisdiction: string | null
    issued_on: string | null
    expires_on: string | null
    effective_expires_on: string | null
  } | null
}

// --- chat -----------------------------------------------------------------

export interface Citation {
  source: string
  reference: string
  confidence: number
}

export interface ChatTurn {
  job_id: string
  answer: string
  citations: Citation[]
  session_id: string | null
  plan: string[]
  candidates: { id: string; full_name: string; role?: string; jurisdiction?: string | null }[]
  needs_clarification: boolean
}

// --- provisioning ---------------------------------------------------------

/** Generated logins come back once and are never retrievable again. */
export interface IssuedLogin {
  email: string
  password: string
  user_id?: string
  clinician_id?: string
  status?: string
}
