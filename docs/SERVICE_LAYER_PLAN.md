# Service Layer — Implementation Plan

## Why

Routes currently mix HTTP concerns with business logic: `documents.py` does
tenant checks, storage writes and pipeline dispatch inline; `organization.py`
builds ORM rows, hashes passwords and enqueues Celery tasks in the handler.
That makes the logic untestable without HTTP, untestable without FastAPI
overrides, and invisible to non-API callers (Celery tasks, agents) that need
the same operations.

This plan inserts one layer between routes and the DB and states the rules
each layer lives by.

## Target structure

```
app/
├── api/
│   ├── routes/              # controllers: parse → call service → return
│   │   ├── chats.py
│   │   ├── documents.py
│   │   ├── organizations.py # renamed from organization.py (plural, like siblings)
│   │   └── policies.py
│   ├── schemas/             # Pydantic request/response DTOs
│   │   ├── chat.py
│   │   ├── document.py      # NEW: DocumentDetailResponse
│   │   └── organization.py
│   └── dependencies.py      # unchanged (RequestContext, get_db, get_publisher)
├── services/                # NEW: business logic, no HTTP imports
│   ├── __init__.py          # re-exports
│   ├── chat_service.py
│   ├── document_service.py
│   ├── organization_service.py
│   └── policy_service.py
└── core/
    └── exceptions.py        # extended: BadRequestError; AppError → HTTP mapping
```

**No repository layer.** SQLAlchemy's `AsyncSession` already is the unit of
work; a repository would only forward calls at this size. Introduce one when
the same query is needed by two services.

## Layer contract

| Layer | Owns | Never |
|---|---|---|
| Route | auth deps, form/query parsing, status codes, response models | ORM queries, business rules, hashing |
| Service | tenant checks, role checks, storage writes, task dispatch, transaction boundaries | importing FastAPI, raising `HTTPException` |

Services are **plain async functions** taking the session first:

```python
async def onboard_organization(db: AsyncSession, payload: OrganizationOnboardingCreate) -> OrganizationOnboardingResponse:
```

matching the function style already used by `d2_memory` / `d4_connectors`.

## Error handling

Services raise the existing `core.exceptions` hierarchy; one exception handler
in `main.py` maps them to HTTP responses. Routes stop wrapping everything in
`HTTPException`.

| Exception | Status |
|---|---|
| `NotFoundError` | 404 |
| `AuthError` | 403 |
| `BadRequestError` (new) | 400 |
| `NotImplementedError` (policy stub) | 501 |
| other `AppError` | 500 |

Body shape for every mapped error: `{"code": ..., "message": ...}`.

## Migration per route

- **organization** → `organization_service.onboard_organization(db, payload)`:
  org row + compliance-officer user + bcrypt + `send_invitation_email.delay`.
- **documents** → `document_service.upload_document(...)` (tenant check,
  clinician-role self-upload check, dedupe by content hash, `core.storage.save`,
  `inline_tasks` branch preserved verbatim including its mid-request commit)
  and `get_document(...) -> DocumentDetailResponse`.
- **chats** → owner check moves to `chat_service.ensure_job_owner`;
  SSE generator stays in the route (transport is presentation).
- **policies** → `policy_service.upload_policy` raises `NotImplementedError`;
  route keeps the 501 semantics via the error map.

## Testing

`tests/test_services.py`: onboarding happy path and failure paths, document
tenant-boundary rejection, using httpx `ASGITransport` with dependency
overrides (`get_request_context`, `get_db`) — no real Postgres or Redis.

## Deliberately skipped

Repositories, DTO-mapper classes, interface-per-service. Add when duplication
or a second caller actually appears.
