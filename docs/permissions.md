# Permissions

Permissions are defined separately from roles. A role is a bag of scopes, and RBAC is enforced on
the scope — never on the role name — so adding a role means listing what it may do rather than
finding every `if role == ...` in the codebase.

**The source of truth is `ROLE_SCOPES` in [app/d5_security/scopes.py](../app/d5_security/scopes.py).**
`ROLE_PERMISSION_MATRIX` is derived from it, and `has_scope(role, scope)` is the only thing that
should ever be asked. The matrix below is generated from that dict — if you change one, regenerate
the other.

## Scopes

| Group | Scopes |
| :--- | :--- |
| Organization | `organizations:read`, `organizations:update`, `organizations:manage_users`, `organizations:manage_settings` |
| User | `users:read`, `users:create`, `users:update`, `users:delete` |
| Document | `documents:read`, `documents:create`, `documents:update`, `documents:delete` |
| Credential | `credentials:read`, `credentials:verify`, `credentials:manage` |
| Compliance | `compliance:read`, `compliance:run`, `compliance:report` |
| Audit | `audit_logs:read` |

## Role → Permission matrix

Generated from `ROLE_SCOPES`. `YES` = granted; `-` = not granted.

| Permission | Super Admin | Admin | Compliance Officer | HR | Clinician |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `organizations:read` | YES | - | - | YES | - |
| `organizations:update` | YES | - | - | - | - |
| `organizations:manage_users` | YES | - | - | - | - |
| `organizations:manage_settings` | YES | - | - | - | - |
| `users:read` | - | YES | YES | YES | YES |
| `users:create` | - | YES | - | - | - |
| `users:update` | - | YES | - | - | - |
| `users:delete` | - | YES | - | - | - |
| `documents:read` | - | YES | YES | YES | YES |
| `documents:create` | - | YES | YES | YES | - |
| `documents:update` | - | YES | YES | YES | - |
| `documents:delete` | - | YES | YES | - | - |
| `credentials:read` | - | YES | YES | YES | YES |
| `credentials:verify` | - | YES | YES | YES | - |
| `credentials:manage` | - | YES | - | - | - |
| `compliance:read` | - | YES | YES | YES | YES |
| `compliance:run` | - | YES | YES | - | - |
| `compliance:report` | - | YES | YES | - | - |
| `audit_logs:read` | YES | YES | YES | - | - |

### The two things this table does not say

**Scope is not the whole check.** A `YES` grants the *verb*, never the *rows*. `documents:read`
and `credentials:read` are held by every role including clinicians, and a clinician still sees only
their own — the route compares `context.clinician_id` against the record's owner and returns 403
otherwise, and D2 filters every query by `org_id` from the request context underneath that. Scope,
ownership and tenant are three separate gates; see [architecture.md](../architecture.md) §5.

**Super admin is a different kind of account.** It lives in the `admins` table, has no
`organization_id`, and its scopes are deliberately narrow: it onboards organizations and creates
each org's first admin, and cannot read a single credential, document or compliance record in any of
them. `RequestContext.account_type` is `"admin"` for these and `"user"` for everyone else, and
`resolve_org` lets only that account type act across organizations.

### `users:create` is an escalation boundary

Only the org admin creates users. HR held this scope until 2026-09-01 despite
`test_endpoint_add_users_403_hr_role` asserting otherwise — the test was passing only because it
could not reach a database, and once one was up it failed.

The reason it matters: `POST /organizations/{org_id}/users` accepts role `hr` or
`compliance_officer`, and a compliance officer holds `compliance:report`. An HR login able to create
users could therefore mint an account that does what HR itself may not. That is the shape of a
privilege escalation regardless of intent, so `users:create` stays with the org admin.

### `compliance:report` is the one that writes

It is the only scope in this table that authorizes *creating* a record rather than reading or
updating one, so it is worth stating where it is enforced — in three places, not one:

- `POST /reports/{id}/approve`, which is the human-in-the-loop gate itself.
- The `/chat` orchestrator's `authorize` node, which refuses a `report` flow to any role without it
  before a single domain call is made. HR reads compliance perfectly legitimately and still may not
  cause a report to be written.
- `replan`, which re-runs the same check on any step it appends — a gate that ran only at the start
  would be one a re-planned step walks straight past.

HR's exclusion is deliberate and is the reason `forbidden()` runs for every role rather than only
for clinician logins.

## Discrepancy worth a look

`hr` holds `organizations:read` and `admin` does not. Nothing currently depends on it — no route
requires that scope — but it reads as an oversight in `ROLE_SCOPES` rather than a decision, since
an org admin can hardly have less visibility of its own organization than its HR staff. Left as-is
here because this file documents what the code does; fix it in `scopes.py` if it is a bug.
