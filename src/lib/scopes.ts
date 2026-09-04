import type { PlatformRole } from './types'

/**
 * A transcription of `ROLE_SCOPES` in `app/d5_security/scopes.py`.
 *
 * This is a UI convenience and never a security boundary — the API re-checks
 * every scope on every request. Its job is to stop offering people controls
 * that can only answer 403.
 *
 * Keep it in step with the server: `api.test.ts` pins the cells that have
 * already moved once.
 */
const ROLE_SCOPES: Record<PlatformRole, readonly string[]> = {
  // Platform-level only. Onboards organizations and creates each org's first
  // admin; holds no compliance, credential or document scope at all.
  super_admin: [
    'organizations:read',
    'organizations:update',
    'organizations:manage_users',
    'organizations:manage_settings',
    'audit_logs:read',
  ],
  admin: [
    'users:read',
    'users:create',
    'users:update',
    'users:delete',
    'documents:read',
    'documents:create',
    'documents:update',
    'documents:delete',
    'credentials:read',
    'credentials:verify',
    'credentials:manage',
    'compliance:read',
    'compliance:run',
    'compliance:report',
    'audit_logs:read',
  ],
  compliance_officer: [
    'users:read',
    'documents:read',
    'documents:create',
    'documents:update',
    'documents:delete',
    'credentials:read',
    'credentials:verify',
    'compliance:read',
    'compliance:run',
    'compliance:report',
    'audit_logs:read',
  ],
  // `users:create` was removed from HR on 2026-09-01: that route can create a
  // compliance officer, and that role holds `compliance:report`, which HR is
  // denied. Adding it back here would re-open the escalation in the UI.
  hr: [
    'organizations:read',
    'users:read',
    'documents:read',
    'documents:create',
    'documents:update',
    'credentials:read',
    'credentials:verify',
    'compliance:read',
  ],
  clinician: ['users:read', 'documents:read', 'credentials:read', 'compliance:read'],
}

export function hasScope(role: PlatformRole | undefined, scope: string): boolean {
  return role ? ROLE_SCOPES[role].includes(scope) : false
}

/**
 * Note what is deliberately *not* here.
 *
 * `POST /documents/upload` and `POST /credentials/{id}/reverify` gate on
 * ownership rather than scope — a clinician holds neither `documents:create`
 * nor `credentials:verify` and may still act on their own record. But both
 * resolve their target exactly as the matching GET does, so anyone who can load
 * the page can perform the action. A scope gate on those controls would hide
 * them from precisely the people they exist for; an ownership helper would
 * re-derive a check the read already made.
 */

/** `orgs.py` gates the dashboard on a role frozenset, not a scope. Matching the
 *  server matters more than being consistent with the rest of this file. */
export const DASHBOARD_ROLES: PlatformRole[] = ['hr', 'compliance_officer', 'admin']
