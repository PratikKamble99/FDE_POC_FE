# Project Objective — AI Healthcare Compliance & Credential Verification

## 1. What we are building

An AI-assisted compliance platform for healthcare organizations.

Organizations (hospitals, clinics, staffing agencies) upload their clinicians'
**licenses, certifications, vaccination records and compliance documents**.
The platform reads those documents with AI, verifies them against the
organization's policies and against authoritative external sources
(government registries, credential APIs, HRMS), tracks compliance status over
time, and answers plain-language compliance questions with citations.

The system replaces the manual credentialing loop — an HR coordinator reading
a PDF licence, retyping the licence number into a state registry website,
checking an expiry date against a policy binder, and chasing clinicians by
email — with an audited, cited, machine-verified pipeline that a human still
approves before anything leaves the building.

**Scope of the POC:** end-to-end on synthetic/mock clinician records and
sandbox connectors, with **one real government-API path** proven. Going live
at a customer is a configuration change plus the productionization ladder in
§8 — point retrieval at their real regulations, swap sandbox connectors for
real tenants. No domain gets rewritten.

---

## 2. The problems it solves

| Problem today | What the platform does |
|---|---|
| Credential documents are read and retyped by hand | OCR + field extraction, with face and signature checks |
| Uploaded documents are trusted at face value | Cross-checks every field against the authoritative government/credential registry |
| Expiries are discovered late | Scheduled expiry scan → proactive Email/HRMS alerts to HR |
| "Which credentials is this clinician missing?" takes hours | Required credential set is derived from policy documents and diffed against what is held |
| Compliance reports are assembled manually in spreadsheets | Report generated with per-claim citations, human-approved, then delivered |
| No defensible audit trail | Every action, PHI access and external call written to an immutable audit log |

---

## 3. Core capabilities

- **Document AI** — OCR and structured field extraction (holder name, licence
  number, jurisdiction, issue/expiry dates), document-type classification,
  face verification against the clinician's identity record, and signature/seal
  detection with confidence thresholds and human review on low confidence.
- **Authoritative verification** — the extracted record is diffed against the
  government/credential registry; matches, mismatches and forgery signals are
  each cited to their source.
- **Policy-grounded compliance** — organization policy documents and
  regulations are chunked, embedded and retrieved permission-aware, so
  requirements ("a nurse in this jurisdiction must hold X") come from cited
  policy text rather than model memory.
- **Gap & expiry analysis** — required credential set vs. credentials actually
  held, per clinician and org-wide.
- **Conversational access** — an open-ended `/chat` surface over the same
  services, so questions like *"Is this nursing license expired?"* or
  *"Show missing credentials for Dr. John"* are answered from indexed records.
- **Reporting & notification** — compliance reports and AI summaries with a
  credential timeline per clinician, human-approved, delivered via Email/HRMS.
- **HIPAA posture throughout** — auth, RBAC, PHI/PII masking on ingress and
  egress, tenant isolation, least-privilege connector scopes, immutable audit
  log, and full tracing (tokens, cost, latency, faithfulness).

---

## 4. The core pipeline

```
Upload credential document
  → OCR + face/signature checks
  → embed & retrieve the matching policy
  → Verification Agent cross-checks extracted fields vs policy
  → Government API confirms the credential is genuine & active
  → Report Agent writes the compliance record — only if gaps remain
  → a human approves it
  → Notify HR via Email/HRMS
```

Two qualifications on the last three steps, both of them load-bearing:

- **The report step is conditional.** The upload that closes a clinician's last gap is the common
  one, and it writes no report — a document saying everybody is fine still costs somebody an
  approval. See [AGENTS.md §5](AGENTS.md).
- **Approval is not a step the pipeline performs.** It ends at a
  `compliance_reports` row in `pending_approval`, and stops. Delivery is a separate job, gated on a
  person having set `approved_by` — see §7 below.

Every step runs inside the security wrapper (auth → RBAC → PHI redaction on
the way in; citation/hallucination check → PHI mask → audit log on the way
out) and is traced end to end. The conversational flows reuse the same
services against records this pipeline has already indexed — and one of them,
"generate a compliance report", now enters this pipeline at the report step.

---

## 5. Roles and what they can do

Two different things are called "role" in this system, and they must not be
confused:

- **Platform role** (`users.role`) — what a *login* is allowed to do. This is
  what RBAC is enforced on.
- **Clinical role** (`clinicians.role`) — what a *clinician is*, e.g. nurse,
  physician, technician. This drives **which credentials are required**, not
  what anyone is allowed to see.

### 5.1 Platform roles

Permissions are cumulative: HR includes everything a clinician can do for
their own record; a compliance officer includes everything HR can do.

| Role | Can do | Cannot do |
|---|---|---|
| **Clinician** | Upload their own credential documents; view their own credentials, verification results and timeline; ask questions scoped to their own record | See any other clinician; see org-wide dashboards; generate or approve reports |
| **HR** | Everything above for **any clinician in their organization**; upload on behalf of a clinician; view per-clinician compliance status; view the org-wide compliance dashboard; receive expiry and non-conformance notifications | Approve or send a compliance report; act outside their own organization |
| **Compliance officer** | Everything HR can do, plus: generate compliance reports, **approve a drafted report before it is sent** (the human-in-the-loop gate), download/export reports, upload and manage policy documents | Act outside their own organization; bypass the audit log |
| **Ops / platform admin** | Health and readiness checks, connector configuration (sandbox vs. real), monitoring and trace dashboards | Read clinician PHI through ordinary product surfaces |

Non-human principals, for completeness:

| Principal | Access |
|---|---|
| **External HRMS** | Posts roster-change events to the inbound webhook — authenticated by HMAC signature, not user auth. No read access. |
| **Email provider** | Posts delivery/bounce status to its webhook. No read access. |
| **Connectors** (government, credential, HRMS, email, OCR) | Run under their own least-privilege service credentials, independent of whichever user triggered the call; every call is minimal-disclosure and audited. |

### 5.2 Clinical roles

`clinicians.role` (nurse, physician, technician, …) is an input to the
compliance engine: the required credential set is looked up **per clinical
role and jurisdiction** from the policy documents. Changing a clinician's
clinical role changes what they are required to hold — it grants them no
additional access.

Policy documents additionally carry `allowed_roles`, so a restricted policy is
filtered out of retrieval for users whose role does not permit it — restricted
text never reaches the model's context in the first place.

### 5.3 Where permission is enforced

Three distinct layers; no single one covers everything:

1. **User → API** — coarse-grained role gate at ingress: may this role hit
   this endpoint or intent at all.
2. **User → data row** — fine-grained org/tenant ACL filtering at retrieval
   and memory-lookup time, driven by the request context. This is what stops
   one organization's data from ever entering another's context.
3. **System → external API** — connector-level least-privilege credentials,
   decided by configuration rather than by the calling user.

---

## 6. Representative flows

| # | Ask | Path |
|---|---|---|
| 0 | A clinician uploads a nursing license | The full pipeline in §4 |
| 1 | *"Is this nursing license expired?"* | History lookup → stored expiry → optional live registry re-check → cited answer |
| 2 | *"Compare the uploaded certificate with government records."* | Load extracted fields → fetch authoritative record → field-level diff → each match/mismatch cited |
| 3 | *"Show missing credentials for Dr. John."* | Load clinician role & history → retrieve required credential set from policy → diff → gaps + expiries |
| 4 | *"Generate compliance report."* | Asked through `/chat`, refused to any role without `compliance:report` → Compliance Agent evaluates the roster (or one named clinician) → prose drafted, every figure copied → `compliance_reports` at `pending_approval` → **officer approves** → deliver via HRMS/Email → audit |

Flow 4 is the only conversational ask that writes anything. It is the exception the chat surface
carries deliberately — *"generate a report"* is a request, not a question, and answering it with a
description of how to generate one would be pedantry. The guards that make it safe are in
[CHAT_ORCHESTRATION.md §8](CHAT_ORCHESTRATION.md).

---

## 7. Guardrails and non-goals

- **Nothing outbound without a human.** Compliance reports and notifications
  to HR are drafted by the system and released by a compliance officer. This is
  structural rather than a rule: the Report Agent declares no `send` capability,
  so no agent — and nothing reachable from `/chat` — has a code path to deliver
  anything. Delivery lives in a task gated on `approved_by`.
- **No uncited compliance claim.** Every requirement, match and mismatch
  points at a source: a policy chunk, an extracted document field, or an
  authoritative registry response.
- **Low confidence escalates, it does not guess.** OCR, face and signature
  checks below threshold are routed to human review rather than passed as
  verified.
- **The platform is not the source of truth for licensure.** It records and
  cites what the authority says; it does not adjudicate licensure itself.
- **The platform does not give legal advice.** It reports compliance status
  against the organization's own loaded policies and regulations.

---

## 8. Path to production

1. **Mock demo** — end-to-end on synthetic records and sandbox connectors.
   The POC deliverable.
2. **Real data + auth** — one real connector (a government registry), real
   OAuth and secret handling, real schema quirks and rate limits.
3. **Security review** — HIPAA controls, RBAC, tenant isolation, PHI masking,
   least-privilege scopes, audit log, data residency.
4. **Scale & cost** — concurrency, streaming, p95 latency, caching, model
   tiering, and a cost-per-verification budget that holds.
5. **Handoff** — runbooks, dashboards, and training for the customer's
   compliance team, so it survives after we leave.

---

## 9. Related documents

- [architecture.md](../architecture.md) — modular-monolith architecture, the
  five domains, the shared `invoke` contract, API routes, folder structure.
- [DB_ERD.md](DB_ERD.md) — entity-relationship diagram for the data model.
