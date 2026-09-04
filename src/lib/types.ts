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

/**
 * Two shapes in one array, built by `_finding_citations` and
 * `_evidence_citations` in the orchestrator:
 *
 *   policy    { source: "policy", reference: <policy_document_id>,
 *               text: <citation_text>, chunk_id }
 *   authority { source: "government.verify_license", reference: <fetched_at>,
 *               text: "authority reported 'VALID'", degraded }
 *
 * `text` is the citation — the actual policy clause or the board's own word.
 * `reference` is an id or a timestamp, which is what a human looks it up by,
 * not what they read. There is no `confidence` field.
 */
export interface Citation {
  source: string
  reference: string | null
  text: string
  chunk_id?: string | null
  /** Authority citations only: the registry was unreachable, so this is stale
   *  rather than negative. */
  degraded?: boolean
}

export interface ChatTurn {
  job_id: string
  answer: string
  citations: Citation[]
  session_id: string | null
  plan: string[]
  candidates: { id: string; full_name: string; role?: string; jurisdiction?: string | null }[]
  needs_clarification: boolean
  /** Non-null only when the turn drafted a report. */
  report_id: string | null
}

/** One row of `GET /chat/conversations`. `title` is the opening question,
 *  trimmed at write time — the sidebar preview, no second copy of the message. */
export interface ConversationSummary {
  id: string
  title: string | null
  updated_at: string
}

export interface ConversationList {
  conversations: ConversationSummary[]
  has_more: boolean
}

/** `POST /chat/conversations` — an empty thread, its id sent with each turn. */
export interface CreatedConversation {
  session_id: string
  title: string | null
}

/** A stored message from `GET /chat/conversations/{id}`. Text is already egress-
 *  masked; `plan`/`candidates`/`report_id` are live-turn only and not persisted. */
export interface StoredMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  citations: Citation[]
}

export interface ConversationDetail {
  session_id: string
  title: string | null
  messages: StoredMessage[]
}

// --- reports --------------------------------------------------------------

export type ReportStatus = 'draft' | 'pending_approval' | 'approved' | 'sent' | 'rejected'

export interface Report {
  report_id: string
  status: ReportStatus
  scope: 'clinician' | 'organization'
  clinician_id: string | null
  format: 'text' | 'markdown'
  /** Rendered from the stored body — nothing recomputed, no model. Ready to
   *  display as-is. */
  text: string
}

/** One row of `GET /reports`. No body — that is what `GET /reports/{id}` is for. */
export interface ReportSummary {
  id: string
  scope: 'clinician' | 'organization'
  status: ReportStatus
  clinician_id: string | null
  created_at: string
}

export interface ReportList {
  reports: ReportSummary[]
  has_more: boolean
}

// --- policies -------------------------------------------------------------

/** app/db/models/enums.py — SUPERSEDED is retired, not deleted: its chunks stay
 *  resolvable so a finding made against them last year is still explainable. */
export type PolicyDocumentStatus = 'draft' | 'published' | 'superseded'

/**
 * One rule the extractor proposed, as `GET /policies/{id}/review` returns it.
 *
 * `citation_text` is in the payload rather than behind a click — it is what
 * makes review possible at a glance — and it is the one column an officer may
 * not edit. A citation someone can rewrite is not evidence.
 */
export interface ProposedRequirement {
  id: string
  credential_type: string
  role: string
  jurisdiction: string | null
  is_mandatory: boolean
  renewal_months: number | null
  grace_period_days: number
  disallowed_authority_statuses: string[]
  citation_text: string | null
  source_chunk_id: string | null
  /** Sorts the queue least-confident first; the server already ordered it. */
  extractor_confidence: number | null
  status: 'pending' | 'active' | 'rejected' | 'superseded'
}

export interface PolicyReview {
  policy_document_id: string
  title: string
  status: PolicyDocumentStatus
  requirements: ProposedRequirement[]
}

/** One row of `GET /policies`. No rules, no chunks — `GET /policies/{id}/review`
 *  carries those. */
export interface PolicySummary {
  id: string
  title: string
  status: PolicyDocumentStatus
  jurisdiction: string | null
  version: string | null
}

export interface PolicyList {
  documents: PolicySummary[]
  has_more: boolean
}

/** The officer's corrections, applied at publish. Absent field means "leave it
 *  alone" — the API reads it with `exclude_unset`, so only send what changed. */
export interface RequirementEdit {
  role?: string
  credential_type?: string
  jurisdiction?: string | null
  is_mandatory?: boolean
  renewal_months?: number | null
  grace_period_days?: number
  disallowed_authority_statuses?: string[]
}

export interface PublishResult {
  policy_document_id: string
  status: PolicyDocumentStatus
  activated: number
  rejected: number
  /** Set only when `replace_existing` retired the predecessor in the same
   *  transaction. */
  replaced: { policy_document_id: string; requirements_superseded: number } | null
}

// --- the human review queue -----------------------------------------------

/** One check escalated to a person. Each row carries its subject so a reviewer
 *  can triage without a request per row. */
export interface ReviewCheck {
  id: string
  check_type: string
  confidence: number | null
  details: Record<string, unknown>
  model: string | null
  created_at: string
  credential_document_id: string
  document_type: string
  credential_type: string | null
  clinician_id: string
  clinician_name: string
  clinician_role: string
}

export interface ReviewQueue {
  checks: ReviewCheck[]
  limit: number
  offset: number
  /** From fetching one extra row, not a second COUNT. */
  has_more: boolean
}

export interface ReviewResult {
  check_id: string
  review_status: string
  reviewed_by: string
  /** Set when rejecting also rejected the credential. Null when it did not —
   *  an approval, or a superseded credential left alone. */
  credential_status: string | null
}

// --- job stream terminal payloads ----------------------------------------

/** `CompleteEvent.output` for the document pipeline. */
export interface DocumentPipelineOutput {
  credential_document_id?: string
  credential_id?: string | null
  escalated?: string[]
  /** Null when the clinician had no mandatory gaps left — the Report Agent's
   *  `only_if_gaps` decided there was nothing worth queuing an approval for. */
  report_id?: string | null
  outcome?: string
  credential_status?: string
  authority_status?: string
  degraded?: boolean
  /** Identical bytes already processed in this org; the pipeline did not re-run. */
  deduped?: boolean
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
