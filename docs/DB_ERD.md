```mermaid
erDiagram
  ORGANIZATIONS ||--o{ USERS : employs
  ORGANIZATIONS ||--o{ CLINICIANS : employs
  ORGANIZATIONS ||--o{ CREDENTIAL_REQUIREMENTS : defines
  ORGANIZATIONS ||--o{ POLICY_DOCUMENTS : owns
  ORGANIZATIONS ||--o{ CONVERSATION_SESSIONS : scopes
  ORGANIZATIONS ||--o{ COMPLIANCE_REPORTS : owns
  ORGANIZATIONS ||--o{ AUDIT_EVENTS : scopes

  ADMINS ||--o{ ORGANIZATIONS : onboards

  CLINICIANS ||--o{ CREDENTIAL_DOCUMENTS : uploads
  CLINICIANS ||--o{ CREDENTIALS : holds
  CLINICIANS ||--o{ COMPLIANCE_REPORTS : scoped_to

  USERS ||--o{ CREDENTIAL_DOCUMENTS : uploaded_by
  USERS ||--o{ CONVERSATION_SESSIONS : opens
  USERS ||--o{ COMPLIANCE_REPORTS : approves
  USERS ||--o{ DOCUMENT_CHECKS : reviews
  USERS ||--o{ POLICY_DOCUMENTS : uploaded_by
  USERS ||--o{ CREDENTIAL_REQUIREMENTS : approves
  USERS |o--o| CLINICIANS : self_service_login

  CREDENTIAL_DOCUMENTS ||--o| OCR_RESULTS : yields
  CREDENTIAL_DOCUMENTS ||--o{ DOCUMENT_CHECKS : yields
  CREDENTIAL_DOCUMENTS ||--o{ CREDENTIALS : extracted_into

  CREDENTIALS ||--o| CREDENTIALS : supersedes
  CREDENTIALS ||--o{ VERIFICATIONS : verified_by
  CREDENTIALS ||--o{ EXTERNAL_VERIFICATIONS : checked_against
  CREDENTIALS ||--o{ NOTIFICATIONS : expiry_alert

  POLICY_DOCUMENTS ||--o{ CHUNKS : chunked_into
  POLICY_DOCUMENTS ||--o{ CREDENTIAL_REQUIREMENTS : operationalized_as
  CHUNKS ||--o{ CREDENTIAL_REQUIREMENTS : cited_by

  CONVERSATION_SESSIONS ||--o{ MESSAGES : contains
  MESSAGES ||--o| AGENT_RUNS : produced_by
  AGENT_RUNS ||--o{ VERIFICATIONS : produced

  COMPLIANCE_REPORTS ||--o{ NOTIFICATIONS : triggers

  ORGANIZATIONS {
    uuid id PK
    string name
    string email UK
    string phone
    int no_of_employees
    uuid created_by_admin_id FK
    timestamp created_at
  }
  ADMINS {
    uuid id PK
    string name
    string email UK
    string password_hash
    string role "fixed to 'super_admin'"
    timestamp created_at
  }
  USERS {
    uuid id PK
    uuid organization_id FK
    uuid clinician_id FK
    string email "unique per org"
    string full_name
    string password_hash
    boolean is_active
    enum role "platform_role: clinician | hr | compliance_officer | admin"
    timestamp created_at
  }
  CLINICIANS {
    uuid id PK
    uuid organization_id FK
    string full_name
    enum role "clinical_role"
    string jurisdiction
    string npi
    timestamp created_at
  }
  CREDENTIAL_DOCUMENTS {
    uuid id PK
    uuid organization_id FK
    uuid clinician_id FK
    uuid uploaded_by FK
    enum document_type
    enum credential_type "declared by uploader; nullable"
    string storage_uri
    string content_hash
    string mime_type
    enum status
    timestamp created_at
  }
  OCR_RESULTS {
    uuid id PK
    uuid credential_document_id FK
    jsonb extracted_fields
    numeric confidence
    string model
    timestamp created_at
  }
  DOCUMENT_CHECKS {
    uuid id PK
    uuid organization_id FK
    uuid credential_document_id FK
    enum check_type
    boolean passed
    numeric confidence
    enum review_status
    uuid reviewed_by FK
    jsonb details
    string model
    timestamp created_at
  }
  CREDENTIALS {
    uuid id PK
    uuid organization_id FK
    uuid clinician_id FK
    uuid source_credential_document_id FK
    enum credential_type
    string identifier
    string holder_name
    string jurisdiction
    date issued_on
    date expires_on
    date effective_expires_on
    enum authority_status
    timestamp authority_checked_at
    enum status
    uuid supersedes_credential_id FK
    enum source
    timestamp created_at
  }
  CREDENTIAL_REQUIREMENTS {
    uuid id PK
    uuid organization_id FK
    uuid policy_document_id FK
    uuid source_chunk_id FK
    string citation_text
    enum role
    enum credential_type
    enum source
    string jurisdiction
    boolean is_mandatory
    int grace_period_days
    int renewal_months
    string_array disallowed_authority_statuses
    enum status
    uuid approved_by FK
    timestamp approved_at
    numeric extractor_confidence
    timestamp created_at
  }
  VERIFICATIONS {
    uuid id PK
    uuid organization_id FK
    uuid credential_id FK
    uuid credential_document_id FK
    uuid agent_run_id FK
    enum outcome
    jsonb mismatches
    timestamp created_at
  }
  EXTERNAL_VERIFICATIONS {
    uuid id PK
    uuid organization_id FK
    uuid credential_id FK
    string source
    jsonb request_payload
    jsonb response_payload
    enum authority_status
    timestamp fetched_at
  }
  POLICY_DOCUMENTS {
    uuid id PK
    uuid organization_id FK
    uuid uploaded_by FK
    string title
    string jurisdiction
    string version
    enum status
    date effective_from
    date effective_to
    string source_uri
    string content_hash
    enum_array allowed_roles
    timestamp created_at
  }
  CHUNKS {
    uuid id PK
    uuid policy_document_id FK
    int chunk_index
    text content
    vector embedding
    string jurisdiction
    string version
    jsonb metadata
  }
  CONVERSATION_SESSIONS {
    uuid id PK
    uuid organization_id FK
    uuid user_id FK
    string title
    timestamp created_at
  }
  MESSAGES {
    uuid id PK
    uuid session_id FK
    uuid agent_run_id FK
    enum role
    text content
    jsonb citations
    timestamp created_at
  }
  AGENT_RUNS {
    uuid id PK
    uuid organization_id FK
    enum domain
    string agent_name
    jsonb input
    jsonb output
    jsonb citations
    string trace_id
    int tokens
    numeric cost_usd
    int latency_ms
    enum status
    timestamp created_at
  }
  COMPLIANCE_REPORTS {
    uuid id PK
    uuid organization_id FK
    uuid clinician_id FK
    uuid approved_by FK
    enum scope
    enum status
    jsonb body
    timestamp created_at
  }
  NOTIFICATIONS {
    uuid id PK
    uuid organization_id FK
    uuid report_id FK
    uuid credential_id FK
    enum channel
    string recipient
    string template
    string idempotency_key
    enum status
    timestamp sent_at
  }
  AUDIT_EVENTS {
    bigint id PK
    uuid organization_id FK
    uuid actor_user_id
    string action
    string resource_type
    uuid resource_id
    boolean phi_accessed
    inet ip_address
    timestamp occurred_at
  }
```

## POC 2 · migration delta against the existing ERD

> Historical record of the POC 2 delta. The diagram above is the authoritative
> schema. Note: the `external_verifications.authority_status_raw` and
> `degraded` columns below were never applied — they exist only in this note.

### 12 columns, 1 constraint, 2 indexes. No new tables, nothing dropped.

BEGIN;

### 1. Policy documents: draft -> published gate.

### Nothing is retrievable and no requirement is active until published.

ALTER TABLE policy_documents
ADD COLUMN status text NOT NULL DEFAULT 'draft'
CHECK (status IN ('draft','published','superseded')),
ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

### 2. Credential requirements: the compliance-officer review gate,

### plus the two fields verification actually needs.

ALTER TABLE credential_requirements
ADD COLUMN renewal_months int, -- BLS prints no expiry date
ADD COLUMN disallowed_authority_statuses text[]
DEFAULT '{probationary,restricted,suspended,lapsed,revoked}',
ADD COLUMN status text NOT NULL DEFAULT 'pending'
CHECK (status IN ('pending','active','rejected')),
ADD COLUMN approved_by uuid REFERENCES users(id),
ADD COLUMN approved_at timestamptz,
ADD COLUMN extractor_confidence numeric, -- sorts the review table
ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

### An active rule always has a person behind it. With AUTO_PUBLISH_RULES=true

### pass a system user id, so the shortcut is visible in the data.

ALTER TABLE credential_requirements
ADD CONSTRAINT active_requires_approver
CHECK (status <> 'active' OR approved_by IS NOT NULL);

### Stops duplicate extractions stacking up in the review table.

CREATE UNIQUE INDEX one_active_requirement
ON credential_requirements (organization_id, role, credential_type, jurisdiction)
WHERE status = 'active';

### 3. Credentials: derived expiry. expires_on stays as-printed so a

### disagreement between printed and derived is visible, not overwritten.

ALTER TABLE credentials
ADD COLUMN effective_expires_on date;

CREATE INDEX credential_expiry_scan
ON credentials (organization_id, effective_expires_on)
WHERE status IN ('verified','expiring_soon');

### 4. External verifications: verbatim board string beside the canonical enum,

### and an explicit degraded flag. Unreachable after retries is not verified.

ALTER TABLE external_verifications
ADD COLUMN authority_status_raw text,
ADD COLUMN degraded boolean NOT NULL DEFAULT false;

COMMIT;
