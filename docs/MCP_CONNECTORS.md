# D4 Connectors — MCP Guide

This document covers the **D4 Connectors** domain: what MCP servers/tools exist,
what they do, how they are wired, and how to call them.

## 1. Where this fits

The system is a **modular monolith** split into five domains (D1–D5). **D4
(Connectors)** owns *all* outbound integration with the outside world —
government registries, HRMS, credential APIs, email, and OCR.

- Every external call goes through an **MCP (Model Context Protocol) server** over **stdio** transport.
- Each connector has a **sandbox** (simulated) and a **real** implementation, toggled independently per connector via config.
- D3 (orchestrator) never talks to MCP directly — it calls `ConnectorService.invoke()` which routes through MCP.
- All tool calls are wrapped in the shared `invoke` contract (`InvokeRequest` / `InvokeResponse`).

```
D3 orchestrator
    │  InvokeRequest(domain="d4", action="government.verify_license", ...)
    ▼
D4 ConnectorService.invoke()
    │  active_mode() → sandbox or real
    ▼
McpClientManager.call_tool()          # spawns MCP server as subprocess (stdio)
    ▼
MCP server (e.g. government_server.py)  # FastMCP
    ▼
Adapter (sandbox or real)             # BaseAdapter dispatch to _handle_<tool>
    ▼
ToolResult → InvokeResponse
```

## 2. Connector catalog

Five connectors. Each exposes tools whose input schemas are defined by Pydantic
models in `app/d4_connectors/adapters/<connector>/__init__.py`.

### Government — `app/d4_connectors/servers/government_server.py`

| Tool | Input | Purpose |
|---|---|---|
| `verify_license` | `license_number`, `jurisdiction` | Verify a clinician license against the official registry |
| `check_license_status` | `license_number`, `jurisdiction` | Check current standing/status of a license |
| `check_disciplinary_actions` | `provider_id`, `jurisdiction` | Check disciplinary actions or sanctions |

**Sandbox behavior** (`government/sandbox_adapter.py`): deterministic fake data
derived from a SHA-256 hash of the ID. License prefixes control the result:

| Prefix | Result |
|---|---|
| `OK...` | VALID (verified=true) |
| `EX...` | EXPIRED |
| `NV...` | NOT_FOUND |
| anything else | Hash-derived: VALID / EXPIRED / SUSPENDED / NOT_FOUND |

**Real adapter**: GETs `/v1/licenses/verify`, `/v1/licenses/status`,
`/v1/providers/discipline` on `GOVERNMENT_API_BASE_URL`.

### HRMS — `app/d4_connectors/servers/hrms_server.py`

| Tool | Input | Purpose |
|---|---|---|
| `get_employee` | `employee_id` | Fetch an employee/worker profile |
| `search_employees` | `query`, `department` | Search employees by name or identifier |
| `resolve_employee_ref` | `internal_ref` | Translate an internal app ref (e.g. `clinician_id`) to the HRMS vendor's employee id |
| `notify` | `organization_id`, `recipient`, `template`, `idempotency_key`, `channel`, `report_id`, `credential_id` | Send a notification to HR; persists a `Notification` DB row |

**Sandbox behavior** (`hrms/mock_adapter.py`): 4 hardcoded employees
(`E1001`–`E1004`) in memory; ref map `C-1001`→`E1001`, etc. `notify` writes a
real `Notification` row (deduped by `organization_id` + `idempotency_key`).

**Real adapters**: `WorkdayHrmsAdapter` (`WORKDAY_*` env vars) and
`BamboohrHrmsAdapter` (`BAMBOO_HR_*`). `resolve_employee_ref` and `notify`
raise `NotImplementedError` in both real adapters.

### Credential — `app/d4_connectors/servers/credential_server.py`

| Tool | Input | Purpose |
|---|---|---|
| `get_credentials` | `clinician_id` | Fetch all credential records for a clinician |
| `verify_credential` | `credential_id` | Verify a single credential |
| `get_expiration_summary` | `clinician_id` | Summarize expirations (total / expiring_soon / expired) |

**Sandbox behavior** (`credential/sandbox_adapter.py`): generates 3 fake
credentials per clinician — `state_license`, `dea_registration`,
`board_certification` — with future expiry dates. The board certification is
always `expiring_soon` (~1 month out).

**Real adapter**: GETs `/v1/clinicians/{id}/credentials`,
`/v1/credentials/{id}/verify`, `/v1/clinicians/{id}/credentials/expiry`.

### Email — `app/d4_connectors/servers/email_server.py`

| Tool | Input | Purpose |
|---|---|---|
| `send_email` | `to`, `subject`, `body` | Send an email notification |
| `check_delivery` | `message_id` | Check delivery status of a sent email |

**Sandbox behavior** (`email/sandbox_adapter.py`): in-memory mailbox. Emails to
`bounce@example.com` report `bounced`; everything else reports `delivered`.

**Real adapter**: POSTs `/v1/messages`, GETs `/v1/messages/{id}/delivery`.

### OCR — `app/d4_connectors/servers/ocr_server.py`

| Tool | Input | Purpose |
|---|---|---|
| `extract_document` | `document_ref`, `content_type` (default `application/pdf`) | Submit a document for text extraction |
| `get_ocr_status` | `job_id` | Fetch status and extracted fields of an OCR job |

**Sandbox behavior** (`ocr/sandbox_adapter.py`): assigns `ocr-<n>` job ids;
`get_ocr_status` returns hardcoded extracted fields (provider name, license
number, DOB, issuer, confidence 0.97).

**Real adapter** (`OCR_MODE=real`): `OcrRealAdapter` extracts fields through
OpenAI vision (`OPENAI_API_KEY`, model via `OPENAI_OCR_MODEL`, default
`gpt-4o-mini`). `extract_document` reads the file bytes from `document_ref`
(the local storage path), submits a background extraction, and returns a job
id; `get_ocr_status` awaits the result up to `OCR_RESULT_WAIT_SECONDS` before
reporting `processing`. Output fields match the sandbox shape
(`provider_name`, `license_number`, `issuer`, dates, `confidence`).

## 3. How to call

### A. Direct Python call (fastest for scripts/tests)

```python
import asyncio

from app.contracts.invoke import InvokeRequest
from app.d4_connectors.service import connector_service


async def main() -> None:
    resp = await connector_service.invoke(
        InvokeRequest(
            domain="d4",
            action="government.verify_license",
            payload={"license_number": "OK1234", "jurisdiction": "CA"},
        )
    )
    print(resp.ok, resp.data, resp.citations)


asyncio.run(main())
```

Action format: `"<connector>.<tool>"` where connector ∈ `government | hrms |
credential | email | ocr`. Special actions: `discover` (all connectors) and
`<connector>.discover` (catalog for one connector).

### B. Call an MCP server directly (stdio)

Each server runs standalone. It reads/writes JSON-RPC on stdin/stdout:

```bash
python -m app.d4_connectors.servers.government_server
```

Usually you don't do this by hand — `McpClientManager` spawns the server as a
subprocess and manages the session. To enumerate the live tools of a connector:

```python
import asyncio
from app.config import ConnectorMode
from app.contracts.connector import ConnectorName
from app.d4_connectors.mcp_client_manager import McpClientManager

async def main() -> None:
    manager = McpClientManager()
    tools = await manager.list_tools(ConnectorName.GOVERNMENT, ConnectorMode.SANDBOX)
    for t in tools:
        print(t["name"], "—", t["description"])
    await manager.aclose()

asyncio.run(main())
```

### C. From the orchestrator (D3, future)

The orchestration layer constructs the same `InvokeRequest` — this is the
intended production path:

```python
InvokeRequest(
    domain="d4",
    action="hrms.notify",
    payload={
        "organization_id": "5e4f...",
        "recipient": "E1001",
        "template": "expiry",
        "idempotency_key": "lic-1234-2026-08",
        "channel": "hrms",
        "report_id": None,
        "credential_id": None,
    },
    context={"user_id": "u-1", "org_id": "o-1"},
)
```

### D. Discover the catalog

```python
import asyncio
from app.d4_connectors.discovery import discover

async def main() -> None:
    print(await discover())           # all connectors + tools
    print(await discover("government"))  # just government

asyncio.run(main())
```

## 4. Sandbox / real switching

Each connector has an independent mode switch — you can go live one at a time:

| Connector | Env var | Values |
|---|---|---|
| Government | `GOVERNMENT_API_MODE` | `sandbox` (default) \| `real` |
| Credential | `CREDENTIAL_MODE` | `sandbox` \| `real` |
| Email | `EMAIL_MODE` | `sandbox` \| `real` |
| OCR | `OCR_MODE` | `sandbox` \| `real` |
| HRMS | `HRMS_VENDOR` | `mock` (default → sandbox) \| `workday` \| `bamboohr` (→ real) |

The global `CONNECTOR_MODE` exists but per-connector vars take precedence
(factory reads each connector's own var).

**Real mode requires** the matching `*_BASE_URL` / `*_API_KEY` env vars; a
missing base URL raises `ConfigError` at adapter construction.

## 5. Sandbox simulation knobs

Sandbox adapters inject realistic latency and failures so timeouts/streaming
behavior get exercised before a real dependency is in the loop.

| Env var | Default | Meaning |
|---|---|---|
| `SANDBOX_LATENCY_MIN_MS` | `300` | Min delay per call |
| `SANDBOX_LATENCY_MAX_MS` | `2000` | Max delay per call |
| `SANDBOX_FAILURE_RATE` | `0.03` | Fraction of calls that fail permanently |
| `SANDBOX_TRANSIENT_RETRY_RATE` | `0.10` | Fraction that fail once, succeed on retry |
| `SANDBOX_SEED` | — | Optional seed for deterministic behavior |

For tests, set all four knobs to `0` (see `tests/conftest.py`).

## 6. File map

```
app/d4_connectors/
├── service.py                    # ConnectorService.invoke() — D4 entry point
├── mcp_client_manager.py         # Spawns/owns MCP stdio sessions, calls tools
├── factory.py                    # Server module + mode + adapter selection
├── discovery.py                  # build_catalog() / discover() tool catalog
├── servers/
│   ├── government_server.py      # FastMCP: verify_license, check_license_status, check_disciplinary_actions
│   ├── hrms_server.py            # FastMCP: get_employee, search_employees, resolve_employee_ref, notify
│   ├── credential_server.py      # FastMCP: get_credentials, verify_credential, get_expiration_summary
│   ├── email_server.py           # FastMCP: send_email, check_delivery
│   └── ocr_server.py             # FastMCP: extract_document, get_ocr_status
└── adapters/
    ├── _base.py                  # BaseAdapter dispatch + RealHttpAdapter (httpx + tenacity retries)
    ├── _sandbox.py               # SandboxSimulator (latency/failure injection)
    ├── government/               # sandbox + real
    ├── hrms/                     # mock + workday + bamboohr
    ├── credential/               # sandbox + real
    ├── email/                    # sandbox + real
    └── ocr/                      # sandbox + real
```

## 7. Known TODOs

- **`email_server.py` tool signature is stale.** It still exposes
  `send_email(to, subject, body)`, but `EmailSandboxAdapter` was restructured
  to persist `Notification` rows with fields like `organization_id`,
  `idempotency_key`, etc. Align the MCP server tool with the adapter's
  `SendEmailInput` the same way `hrms_server.notify` was aligned with
  `NotifyInput`.
- **MCP context plumbing not wired.** `McpClientManager.call_tool` doesn't
  forward `InvokeRequest.context` to the MCP server (e.g. `organization_id` for
  `notify`). Plumb it via the MCP `meta` param when orchestration lands.
