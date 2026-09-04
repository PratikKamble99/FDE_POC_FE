# API reference

Every HTTP endpoint the service exposes, as it exists in
[app/api/routes/](../app/api/routes/) today. Nothing aspirational — a route not in this file is a
route you cannot call.

FastAPI serves its own generated schema at `/docs` and `/openapi.json`; this file exists for the
parts a schema cannot state — which flows are asynchronous, which checks run where, and what a
response means.

**Related:** [permissions.md](permissions.md) for the role→scope matrix ·
[architecture.md §6](../architecture.md) for why the routes split the way they do ·
[REDIS_PUBSUB_EVENTS.md](REDIS_PUBSUB_EVENTS.md) for the SSE event contract ·
[AGENTS.md §7](AGENTS.md) for which agent each route sets off.

---

## 1. How a request is authenticated

Every route except `POST /auth/login`, `POST /auth/refresh` and `GET /health` requires a valid access
token, read by `get_request_context` from either:

- the **`access_token` cookie** (httponly, set by `/auth/login`; `secure` only when `ENV=production`), or
- an **`Authorization: Bearer <token>` header** — the scheme is matched case-insensitively.

The cookie is checked first. There is no session store: the token is a signed JWT.

**The token is not trusted for who you are.** `decode_token` verifies signature and expiry, and then
the dependency re-reads the `users` row on every request to fetch `organization_id`, `role`,
`is_active` and `clinician_id`. So a deactivated or deleted account stops working immediately rather
than at token expiry, and `role`/`org_id` can never be claimed by the client. That read uses its own
short-lived session rather than the request-scoped one — an SSE stream can stay open for minutes, and
holding a pooled connection for the whole stream would exhaust the pool under very little traffic.

The resolved `RequestContext` is `{user_id, org_id, role, account_type, clinician_id}`. Platform
super admins live in the `admins` table and carry `org_id: null`, `account_type: "admin"`.

### Three gates, not one

A route may pass RBAC and still refuse you:

| Gate | Where | Refuses with |
|---|---|---|
| **Scope** — may this *role* perform this verb | `require_scope(...)` dependency, or `has_scope` in the handler | 403 |
| **Ownership** — is this *your* record | in the handler: `context.clinician_id` vs the row's owner | 403 |
| **Tenant** — is this row in *your* organization | D2, filtering every query on `context["org_id"]` | 404 |

Tenant failures are 404 rather than 403 on purpose: answering differently would confirm the record
exists in somebody else's organization.

### Error shape

Domain errors are converted once, in [main.py](../app/main.py), to
`{"code": "...", "message": "..."}`:

| Exception | Status |
|---|---|
| `NotFoundError` | 404 |
| `ConflictError` | 409 |
| `UnauthorizedError` | 401 |
| `ScopeDeniedError`, `AuthError` | 403 |
| `BadRequestError` | 400 |
| `NotImplementError` | 501 |
| anything else | 500 |

Routes that raise `HTTPException` directly answer with FastAPI's `{"detail": "..."}` instead. The two
shapes coexist; a client should read `message` or `detail`.

---

## 2. Synchronous or job-backed?

Three routes kick off background work. All three return a `job_id` you follow on
`GET /chat/stream/{job_id}` — the SSE stream is shared, not chat-specific.

| Route | Work it starts |
|---|---|
| `POST /chat` | orchestrator plans and runs 1–3 reads, composes an answer |
| `POST /documents/upload` | OCR → checks → credential → verification → maybe a report draft |
| `POST /credentials/{id}/reverify` | one registry call and its evidence rows |

**`INLINE_TASKS=true` changes their response shape.** In that development mode the work runs inside
the request on the API's own event loop and the route answers with the *finished result* instead of
just a job id. The stream still carries the same events for a client that subscribed. Both shapes are
documented per route below. Production leaves it `false`.

Ownership of a job is recorded in Redis at dispatch, so only the caller who started a job can read
its stream.

---

## 3. Authentication

### `POST /auth/login`

No auth required.

```json
{ "email": "officer@hospital.org", "password": "..." }
```

→ `200`, and sets the `access_token` and `refresh_token` cookies:

```json
{
  "account": {
    "account_type": "user",
    "user_id": "…", "email": "officer@hospital.org",
    "role": "compliance_officer", "org_id": "…", "name": "Ada Okafor"
  },
  "access_token": "…", "refresh_token": "…",
  "token_type": "bearer", "expires_in": 3600
}
```

`expires_in` is the access token's lifetime in seconds — `ACCESS_TOKEN_EXPIRE_MINUTES`, 60 by
default. The refresh cookie lives `REFRESH_TOKEN_EXPIRE_DAYS`, 7 by default.

`org_id` is `null` for a platform super admin. Tokens are returned in the body *as well as* set as
cookies, so a non-browser client need not handle cookies at all.

Failures are deliberately indistinguishable: a wrong password, an unknown email and a deactivated
account all answer the same 401.

### `POST /auth/refresh`

Reads the **`refresh_token` cookie** — not a body, not a header. Rotates both cookies and returns the
same `LoginResponse` shape. `401` if the cookie is missing, expired, or not a refresh token.

There is no `/auth/logout`; clear the cookies client-side.

---

## 4. Chat

### `POST /chat`

Any authenticated role. **No scope check on the endpoint** — what a role may *ask* is a question
about the plan, not the URL, so every role may call `/chat` and the orchestrator's `authorize` node
refuses the parts they may not have before any database read happens. See
[CHAT_ORCHESTRATION.md](CHAT_ORCHESTRATION.md).

```json
{ "message": "Show missing credentials for Dr. John", "session_id": null }
```

`message` is 1–2000 characters. Omit `session_id` on the first turn and send back the one you get to
continue a conversation — it is checked against the caller's org *and* user, because a session id is
a bearer token for a conversation.

**Queued** (`INLINE_TASKS=false`):

```json
{ "job_id": "…", "status": "processing" }
```

**Inline** (`INLINE_TASKS=true`) — the finished turn:

```json
{
  "job_id": "…",
  "answer": "John Abara is missing 2 mandatory credentials…",
  "citations": [{ "source": "policy", "reference": "…", "text": "HR-CRED-004 §3: …", "chunk_id": "…" }],
  "session_id": "…",
  "plan": ["clinician"],
  "candidates": [],
  "needs_clarification": false,
  "report_id": null
}
```

| Field | Means |
|---|---|
| `plan` | which reads the turn decided to make, in order |
| `candidates` | populated when a name matched 0 or 2+ clinicians — the answer is a question back |
| `needs_clarification` | the answer is a question, not an answer |
| `report_id` | non-null only when the turn drafted a report (see §7) |

A **refusal** is not an error: it returns 200 with the refusal in `answer`. `400` only when the turn
could not run at all.

### `GET /chat/stream/{job_id}`

Server-sent events, `text/event-stream`. Only the user who started the job may subscribe.

Each message is one JSON event — `ProgressEvent`, then exactly one terminal event (`complete`,
`error`, or `awaiting_approval`). If the job already finished, the last event is replayed
immediately and the stream closes. `: ping` comments every **15s**; the stream self-terminates with a
synthetic error event after **120s**.

Progress events carry a hand-written `detail` label and **never** raw domain output — nothing has
passed an egress mask at that point. See [REDIS_PUBSUB_EVENTS.md](REDIS_PUBSUB_EVENTS.md) for every
step value and payload.

### `GET /chat/status/{job_id}`

Polling fallback reading the same Redis key. Returns the latest event, or
`{"status": "processing", "step": null}` if none yet.

> ⚠️ **Known gap.** Unlike the stream, this route authenticates the caller but does **not** check job
> ownership — `stream_job` calls `ensure_job_owner` and `job_status` does not. Any authenticated user
> holding a job id can read that job's latest event, including a terminal `complete` carrying its
> output. Job ids are UUIDs and the payloads are identifiers rather than PHI, so the exposure is
> narrow, but the two routes should agree. Fix is one line: the same `_ensure_job_owner` call.

---

## 5. Documents

### `POST /documents/upload`

`multipart/form-data`. Clinician (own record only), HR and above.

Note this route enforces **ownership, not scope** — there is no `require_scope("documents:create")`
dependency on it, and clinicians do not hold that scope. The check that matters is in
`document_service`, comparing `context.clinician_id` against the target. Behaviour is correct; the
enforcement is one layer lower than the scope table would suggest.

| Field | |
|---|---|
| `clinician_id` | required — the clinician the document is *about* |
| `file` | required |
| `credential_type` | optional; one of the `CredentialType` values |

**Omitting `credential_type` means an identity document** — the one kind that evidences no
credential. It exists so face matching has something to compare against, and it is why an upload can
legitimately produce no credential, no verification and no report.

A clinician login may only upload against its own record (403 otherwise); HR and above may upload on
anyone's behalf inside their organization.

**Re-uploading identical bytes is not an error.** `uq_credential_documents_org_hash` says the same
bytes in the same org are the same document. If that document was already `processed`, the pipeline
does not re-run — OCR cannot produce a different answer from identical input — but the credential
takes the live slot back, keeping the verification it already has, and the terminal event carries
`"deduped": true`. A `failed` or `uploaded` document *does* re-run: that is a retry, and a retry is
the point.

**Queued:** `{ "job_id": "…", "document_id": "…", "status": "processing" }`
**Deduped** (already-`processed` bytes): `{ "job_id": "…", "document_id": "…", "status": "processed" }`
**Inline:** `{ "job_id": "…", ...GET /documents/{id} }`

`400` malformed `clinician_id`, unknown `credential_type`, or an empty file. `404` clinician not in
your org.

### `GET /documents/{document_id}`

```json
{
  "id": "…", "status": "processed",
  "document_type": "license", "credential_type": "rn_license",
  "ocr": { "extracted_fields": {…}, "confidence": 0.94, "model": "…" },
  "checks": [{ "id": "…", "check_type": "ocr_quality", "passed": true,
               "confidence": 0.94, "review_status": "not_required", "details": {…} }],
  "credential": { "id": "…", "credential_type": "rn_license", "status": "verified",
                  "identifier": "CA-88912", "holder_name": "…", "jurisdiction": "CA",
                  "issued_on": "…", "expires_on": "…", "effective_expires_on": "…" }
}
```

`credential` is `null` for an identity document. A `review_status` of `pending` on any check means it
was escalated to a human rather than failed — low confidence escalates, it does not guess.

`effective_expires_on` may be set where `expires_on` is null: some cards print no expiry, and the
requirement's renewal interval is what makes them scannable. The difference stays visible on purpose.

---

## 6. Credentials

### `POST /credentials/{credential_id}/reverify`

Ask the issuing authority again about one credential.

**Re-verification appends rather than overwrites.** A credential checked at upload and again here
accumulates two evidence rows and two judgments, with only the current state updated. That
accumulation *is* the credential timeline.

`409` if the credential is superseded — a renewal already replaced it, so verify the renewal instead.
A clinician may only re-verify their own.

**Queued:** `{ "job_id": "…", "credential_id": "…", "status": "verifying" }`
**Inline:** `{ "job_id": "…", ...GET /credentials/{id} }`

### `GET /credentials/{credential_id}`

The current state plus the full history.

```json
{
  "id": "…", "credential_type": "rn_license", "status": "mismatch",
  "authority_status": "active", "authority_checked_at": "2026-08-02T00:00:00+00:00",
  "identifier": "CA-88921", "holder_name": "…", "jurisdiction": "CA",
  "issued_on": "…", "expires_on": "…", "effective_expires_on": "…",
  "verifications": [{ "id": "…", "outcome": "mismatch", "mismatches": {…}, "created_at": "…" }],
  "external_verifications": [{ "id": "…", "source": "government.verify_license",
                               "authority_status": "active", "authority_status_raw": "VALID",
                               "degraded": false, "fetched_at": "…" }]
}
```

**Three axes stay separate, and conflating them is the bug this shape prevents:**

- `authority_status` — what the board said.
- each verification's `outcome` — whether the document and the board agreed.
- `status` — what *we* concluded once policy was applied.

`authority_status_raw` is the board's own word, verbatim. When the canonical `authority_status` reads
`unchecked`, the raw string is what a human needs to see. `degraded: true` means the registry was
unreachable and the answer is stale, not negative.

---

## 7. Reports

A compliance report is the one durable, point-in-time record the system produces — findings
themselves are computed live and never stored, so `compliance_reports.body` is where a
defensible-as-of-a-date snapshot belongs.

**Nothing here drafts one.** Reports are drafted by two other flows:

| Drafted by | When |
|---|---|
| `POST /documents/upload` | after verification, **only if** that clinician still has mandatory gaps |
| `POST /chat` | when someone with `compliance:report` asks for one in so many words |

Both stop at `status: "pending_approval"`. The Report Agent declares no `send` capability, so there
is no code path by which an agent can deliver anything. See [AGENTS.md §5](AGENTS.md).

### `GET /reports/{report_id}`

Requires `compliance:read`. Query: `format=text` (default) or `markdown`.

```json
{ "report_id": "…", "status": "pending_approval",
  "scope": "clinician", "clinician_id": "…", "format": "markdown",
  "text": "# Priya Sharma: not compliant\n\nScope: clinician   Generated: 2026-08-31\n…" }
```

Rendered as a pure function of the stored body — nothing recomputed, no model. A report read a year
from now reads exactly as it did the day it was approved.

**Scope is not the whole check on this route.** `compliance:read` is held by *every* role including
clinicians, and D2 filters reports by tenant rather than by subject — so scope alone would let any
clinician read any report in their organization given its id, and an unguessable id is not an access
control. A clinician login is therefore held to reports about itself: `403` for an org-scoped report
(they have no org-wide view at all) and `403` for a clinician-scoped one about somebody else. HR and
above are unrestricted inside their organization.

`400` unsupported format · `403` as above · `404` unknown report, or one in another tenant.

### `POST /reports/{report_id}/approve`

Requires `compliance:report` — **admin and compliance officer only**. HR reads compliance perfectly
legitimately and cannot approve.

```json
{ "report_id": "…", "status": "approved", "approved_by": "…" }
```

`approved_by` is taken from the request context and never from the payload: the approver is whoever
is logged in, not whoever the caller names.

`409` if the report is not at `pending_approval`. Approving an already-`sent` report would read as
success and change nothing; approving a `rejected` one would quietly undo somebody's decision.

**Approval does not send anything today.** `tasks/report_delivery_task.py` is not built, so an
approved report is a signed-off record that nothing has yet posted to HR.

---

## 8. Compliance reads

### `GET /clinicians/{clinician_id}/compliance-status`

Current gaps and expiries for one clinician, with citations. Synchronous — a known-shape question
needing no reasoning, so it calls the domain directly rather than going through `/chat` and a job.

A clinician login is held to its own record (403 otherwise); HR and above may read anyone's inside
the organization.

Returns the Compliance Agent's evaluation: `clinician`, `findings[]`, `summary`, `evaluated_on`.
Every finding carries `state`, `reason{code, detail}`, `is_mandatory` and its `citation_text` —
**no uncited compliance claim**. `summary.compliant` is strict: every *mandatory* requirement must be
`satisfied`, so `pending` does not count as compliant. It is simply a more forgivable reason not to
be.

`400` malformed id · `404` unknown clinician or another tenant's.

### `GET /orgs/{org_id}/dashboard`

The org-wide rollup: `totals`, `counts_by_state`, and a per-clinician `clinicians[]` with each row's
`summary.gaps` — enough to say *why* a row is red without a request per clinician.

**HR, compliance officer and admin only.** A clinician has no org-wide view at all — not a filtered
one, not their own row.

The `org_id` in the path must match your own; a mismatch is `403` (a cross-tenant attempt, not a bad
request — and answering with an empty dashboard would confirm the org exists). The organization
actually queried comes from the request context regardless.

---

## 9. Organization and user administration

### `POST /admin/onboardOrg`

Requires `organizations:update` — **super admin only**. Creates the organization and its first admin
login in one step, generates a password, and emails an invitation.

Request: `{name, email, phone?, no_of_employees, admin_name, admin_email}`
Response: `{org_id, name, admin_email, created_at, status, password}`

The created org admin is then the only account that may add users to that org — the super admin never
adds regular users directly.

### `POST /organizations/{org_id}/users`

Requires `users:create` — **the org admin only**. Adds HR or compliance officer logins in bulk.

```json
{ "users": [{ "email": "…", "full_name": "…", "role": "hr" }] }
```

`role` must be `hr` or `compliance_officer` — you cannot mint an admin here. Returns one
`{email, user_id, password, status}` per user. `resolve_org` requires the path org to match your
token's, unless you are a platform admin.

Neither HR nor the super admin may call this. HR's exclusion is an escalation boundary: this route
can create a compliance officer, and that role holds `compliance:report` — which HR does not. The
super admin's is a separate rule — it creates each org's first admin and nothing else.

### `POST /organizations/{org_id}/clinicians`

Requires `users:create`. **All-or-nothing** — one bad entry rejects the batch, so a partial roster
import cannot leave you guessing which half landed.

```json
{ "clinicians": [{ "full_name": "…", "clinical_role": "nurse",
                   "jurisdiction": "CA", "npi": "…", "email": "…" }] }
```

`email` is optional and generated when omitted. Each clinician gets a paired login. Returns
`{clinician_id, user_id, email, password, status}` per entry. `409` on an NPI collision.

Note `clinical_role` (what a clinician *is* — nurse, physician) is a different axis from the platform
`role` above (what a *login* may do). Conflating them is the mistake this schema is shaped to prevent.

---

## 10. Policy ingestion

Every route here requires `compliance:report` — **admin and compliance officer only**, except
`/policies/search`, which any role holding `compliance:read` may call. Loading the corpus decides
what the whole organization is measured against, so it is not an HR-level action. The flow behind
these routes is in [POLICY_INGESTION.md](POLICY_INGESTION.md).

### `POST /policies/upload`

Multipart: `title`, `file`, `jurisdiction?`, `version?`, `allowed_roles?` (comma-separated). The
document lands at `draft` and ingestion chunks, embeds and extracts proposed rules.

Two response shapes: `{job_id, policy_document_id, status: "processing"}` to follow on
`GET /chat/stream/{job_id}`, or — under `INLINE_TASKS=true` — `{job_id, ...the review payload}`
directly. Every ingestion step arrives on the stream as `d1_rag`, its `detail` naming the stage.

`allowed_roles` is the retrieval filter, not a redaction: a policy whose roles exclude the caller is
dropped from the candidate set *before* its text can reach a model's context. Empty means no
restriction beyond the tenant.

### `GET /policies/{id}/review`

`{policy_document_id, title, status, requirements[]}`, least-confident first. Each requirement
carries its `citation_text` — in the payload rather than behind a second call, because that is what
makes review possible at a glance.

### `POST /policies/{id}/publish`

`{accept: [ids], accept_all?, replace_existing?, edits: {id: {…}}}` → `{activated, rejected,
replaced}`. One transaction: ticked rules go `active` with `approved_by` set to the caller, unticked
ones go `rejected` (kept, not deleted), and the document goes `published`. `accept` and `accept_all`
are mutually exclusive. `edits` is read with `exclude_unset`/`exclude_none`, so an absent field means
"leave it alone" and a `null` is discarded. `citation_text` is not editable — a citation an officer
can rewrite is not evidence.

`replace_existing` is only valid on a document uploaded through `POST /policies/{id}/versions`;
publishing must never be a way to switch off rules the caller never named.

### `POST /policies/{id}/versions`

A revision of an existing policy, as a new draft that knows its predecessor. The old policy keeps
running until the new one is published with `replace_existing`. Byte-identical content is a `409`.

### `DELETE /policies/{id}`

Retire — a soft delete, and the only kind. `{policy_document_id, status, requirements_superseded}`.
Nothing is removed: chunks stay resolvable so a finding made against them last year is still
explainable, and the rules become `superseded` rather than `rejected` because nobody objected to
them.

### `POST /policies/search`

`{query, top_k?, jurisdiction?, mode?}` → chunks and citations, never prose. Requires
`compliance:read`. Not used by this client — `/chat` reaches the same retrieval with an answer
composed around it.

---

## 11. Operations

### `GET /health`

No auth. `{"status": "ok", "env": "development"}`. Liveness only — it does not check Postgres, Redis
or the connectors, so a green `/health` does not mean the pipeline can run.

---

## Route index

| Method | Path | Auth | Sync |
|---|---|---|---|
| POST | `/auth/login` | none | sync |
| POST | `/auth/refresh` | refresh cookie | sync |
| GET | `/health` | none | sync |
| POST | `/chat` | any role | **job** |
| GET | `/chat/stream/{job_id}` | job owner | SSE |
| GET | `/chat/status/{job_id}` | any role | sync |
| POST | `/documents/upload` | own record, or HR+ | **job** |
| GET | `/documents/{document_id}` | own record, or HR+ | sync |
| POST | `/credentials/{credential_id}/reverify` | own record, or HR+ | **job** |
| GET | `/credentials/{credential_id}` | own record, or HR+ | sync |
| GET | `/clinicians/{clinician_id}/compliance-status` | own record, or HR+ | sync |
| GET | `/orgs/{org_id}/dashboard` | HR, CO, admin | sync |
| GET | `/reports/{report_id}` | `compliance:read` | sync |
| POST | `/reports/{report_id}/approve` | `compliance:report` | sync |
| POST | `/organizations/{org_id}/users` | `users:create` | sync |
| POST | `/organizations/{org_id}/clinicians` | `users:create` | sync |
| POST | `/admin/onboardOrg` | `organizations:update` | sync |
| POST | `/policies/upload` | `compliance:report` | **job** |
| POST | `/policies/{id}/versions` | `compliance:report` | **job** |
| GET | `/policies/{id}/review` | `compliance:report` | sync |
| POST | `/policies/{id}/publish` | `compliance:report` | sync |
| DELETE | `/policies/{id}` | `compliance:report` | sync |
| POST | `/policies/search` | `compliance:read` | sync |

### Deliberately absent

Referenced in older drafts of `architecture.md`, and not built:

| Route | Status |
|---|---|
| `POST /reports/generate` | Not built. Chat and upload both draft reports; a third entry point exists only if an admin needs a non-conversational trigger |
| `POST /chat/approve/{job_id}` | Never existed and should not. Approval is `POST /reports/{id}/approve`, against D2 — keeping it off the chat surface is what makes "no agent can release anything" a fact about the code |
| `GET /reports/{id}/download` | Not built. `GET /reports/{id}?format=markdown` returns the text |
| `GET /clinicians/{id}/credentials` | Not built. `GET /credentials/{id}` returns one credential with its full timeline |
| `POST /webhooks/hrms`, `/webhooks/email-status` | Not built |
| `POST /auth/logout` | Not built — clear the cookies client-side |
| `GET /health/ready` | Not built — `/health` is liveness only |
