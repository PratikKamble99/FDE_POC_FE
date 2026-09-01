# Credential Registry — frontend

React client for the AI Healthcare Compliance & Credential Verification API.

Vite · React 19 · TypeScript · React Router · TanStack Query · axios · React Hook Form + zod ·
Tailwind v4 · shadcn/ui primitives.

## Running it

The backend must be up first — it lives at
`../AI-Healthcare-Compliance-and-Credential-Verification`:

```bash
docker compose up -d              # postgres + redis
uv run python -m app.db.seeds     # 25 active requirements; without these every
                                  # finding set is empty and the roster looks broken
INLINE_TASKS=true uv run uvicorn app.main:app --reload --port 8000
```

Then:

```bash
npm install
npm run dev                       # http://localhost:5173
```

`INLINE_TASKS=true` runs the pipeline in-process, so no Celery worker is needed. Upload,
reverify and chat each return **two different shapes** depending on that flag — a finished result
inline, or a job id to follow over SSE. The client handles both, so flip it to `false` to
exercise the streaming path.

| Script | |
|---|---|
| `npm run dev` | dev server with the API proxy |
| `npm run build` | production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint |
| `npm test` | vitest |

## How it talks to the API

The API has no CORS middleware and authenticates with httpOnly cookies. `vite.config.ts`
proxies `/api` → `http://localhost:8000` and strips the prefix, so the browser stays same-origin:
cookies are first-party, and `EventSource` — which cannot send headers — authenticates for free.

`axios.baseURL` is therefore `/api`, relative. Pointing it at `http://localhost:8000` directly
breaks both of those. Override the proxy target with `VITE_API_TARGET` if the API runs elsewhere.

**Deploying** needs the same reverse-proxy arrangement, or `CORSMiddleware` with
`allow_credentials=True` added to `app/main.py`.

## Screens

| Route | Who | |
|---|---|---|
| `/login` | anyone | |
| `/` | hr, compliance officer, admin | Roster with per-clinician gaps |
| `/me` | clinician | Their own record — they get 403 from the roster by design |
| `/clinicians/:id` | hr and above | Findings, each cited to approved policy text |
| `/credentials/:id` | | The three axes, the comparison, the append-only timeline |
| `/documents/:id` | | OCR fields, checks, the drafted credential |
| `/chat` | anyone | Cited answers; ambiguous names become a candidate picker |
| `/team` | hr and above | Bulk-add clinicians and HR/compliance logins |
| `/policies` | hr and above | Not available — the endpoint returns 501 |
| `/admin/organizations/new` | super admin | Onboard an org and its first admin |

Generated passwords are returned once by the API and never again, so `PasswordsDialog` says so
and offers copy-all.

## What isn't here

**Report generation and approval.** `docs/AGENTS.md` §5 specifies `POST /reports/generate` and
`/reports/{id}/approve` — the human-in-the-loop gate that is the product's central guardrail.
No route exists on the API yet, so there is no screen for it. This is the largest missing
surface; `AwaitingApprovalEvent` is already defined on the event stream with nothing to render
into.

**A clinician list endpoint.** The roster exists only inside the dashboard response, so every
clinician picker reads from that one query — which a clinician login cannot call, so their
upload is pinned to their own record.

## Reading the sandbox

`ocr.extract_document` invents a `provider_name` from one hash and `government.verify_license`
invents one from another, so an end-to-end sandbox run reliably shows a `holder_name` mismatch.
That is the sandbox, not a bug — read the identifier, jurisdiction and expiry rows of the
ledger instead.
