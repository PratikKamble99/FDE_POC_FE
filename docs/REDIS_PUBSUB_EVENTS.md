# Redis Pub/Sub Event Streaming — Technical Guide

This document describes the Redis-based real-time event streaming system that connects Celery background workers to FastAPI SSE endpoints for live job progress updates.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           REDIS (3 databases)                               │
├──────────────┬──────────────────────┬──────────────────┬───────────────────┤
│     DB 0     │        DB 1          │      DB 2        │     Pub/Sub       │
│  (default)   │   (celery broker)    │ (result backend) │   (channels)      │
├──────────────┼──────────────────────┼──────────────────┼───────────────────┤
│ Job status   │ Task queue           │ Task results     │ job:{id}:channel  │
│ keys         │                      │                  │                   │
│ Owner keys   │                      │                  │                   │
│ Terminal     │                      │                  │                   │
│ flags        │                      │                  │                   │
└──────────────┴──────────────────────┴──────────────────┴───────────────────┘
         ▲                    ▲                    ▲                ▲
         │                    │                    │                │
┌────────┴────────┐  ┌───────┴────────┐  ┌────────┴────────┐ ┌────┴─────┐
│  FastAPI Web    │  │  Celery Worker │  │  Celery Worker  │ │  ...     │
│  Process        │  │  Process #1    │  │  Process #N     │ │  workers │
│                 │  │                │  │                 │ │          │
│ 1 Redis client  │  │ 1 Redis client │  │ 1 Redis client  │ │          │
│ (app.state)     │  │ (global)       │  │ (global)        │ │          │
└─────────────────┘  └────────────────┘  └─────────────────┘ └──────────┘
```

**Key principle**: One Redis client per process (not per request/task). The web process creates its client at startup via `lifespan()`. Each Celery worker creates its client at process startup via `worker_process_init` signal.

---

## 2. Configuration

All Redis URLs in `app/config.py`:

```python
redis_url: str = "redis://localhost:6379/0"      # Pub/Sub + job status (DB 0)
celery_broker_url: str = "redis://localhost:6379/1"   # Task queue (DB 1)
celery_result_backend: str = "redis://localhost:6379/2"  # Results (DB 2)
```

Environment variables (from `.env`):
```bash
REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=redis://localhost:6379/1
CELERY_RESULT_BACKEND=redis://localhost:6379/2
```

---

## 3. FastAPI Web Process

### 3.1 Redis Client Lifecycle (`app/main.py`)

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    app.state.redis = aioredis.from_url(settings.redis_url, decode_responses=False)
    yield
    # Shutdown
    await app.state.redis.aclose()
```

- Created **once** at application startup
- Stored in `app.state.redis` for dependency injection
- Closed cleanly on shutdown

### 3.2 Publisher Dependency (`app/api/dependencies.py`)

```python
async def get_publisher(request: Request) -> EventPublisher:
    return EventPublisher(request.app.state.redis)
```

Routes receive `EventPublisher` with the shared web-process Redis client.

---

## 4. Celery Worker Process

### 4.1 The Persistent Worker Loop (`app/tasks/worker_loop.py`)

The worker runs **one event loop for its entire lifetime**, created at
`worker_process_init` (post-fork, per child). Every async resource is built
lazily once against that loop and torn down exactly once at shutdown:

```python
# app/tasks/worker_loop.py (essence)
@worker_process_init.connect
def init_worker(**kwargs):
    global _loop
    _loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_loop)

def run_async(coro):
    """Every task enters here -- replaces asyncio.run()."""
    task = get_loop().create_task(coro)
    try:
        return get_loop().run_until_complete(task)
    except SoftTimeLimitExceeded:
        task.cancel()                      # clean cancellation,
        loop.run_until_complete(gather(task, return_exceptions=True))
        raise                              # then Celery marks it failed

class WorkerResources:                     # built lazily, ONCE per process
    redis = aioredis.from_url(...)         # survives across tasks now
    memory  = MemoryService()
    connectors = ConnectorService()        # MCP sessions persist too
    agents  = AgentService(domains={"d2": memory, "d4": connectors})

@worker_process_shutdown.connect
def shutdown_worker(**kwargs):             # ordered teardown, exactly once
    resources.aclose(); dispose_db(); redis.aclose(); loop.close()
```

**Critical details**:
- One loop per worker **process** — created post-fork in `worker_process_init`
- Tasks enter via `run_async(...)`; `asyncio.run()` is banned in task bodies
  (a throwaway loop is what killed shared connections on second tasks)
- Soft time limit → coroutine cancelled and drained before the failure
  propagates, so the next task inherits a clean loop
- Inline (`INLINE_TASKS`) runs on the API's own loop and passes API-scoped
  instances explicitly — worker resources are never touched there

### 4.2 Task Usage Pattern (`app/tasks/document_pipeline_task.py`)

```python
from app.tasks.worker_loop import run_async, resources

@celery_app.task(name="app.tasks.document_pipeline_task.process_document")
def process_document(job_id: str, credential_document_id: str, context: dict) -> None:
    run_async(run_document_pipeline(job_id, credential_document_id, context))

async def run_document_pipeline(job_id, credential_document_id, context):
    res = resources()
    publisher = EventPublisher(res.redis)          # shared, warm
    await publisher.progress(job_id, ProgressEvent(
        step=EventStep.QUEUED, status=EventStatus.RUNNING, detail="queued"
    ))
    # ... pipeline steps ... no finally-cleanup needed --
    # worker shutdown owns resource teardown.
```

---

## 5. Event Publisher (`app/events/publisher.py`)

### 5.1 Class Interface

```python
class EventPublisher:
    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client

    async def publish(self, job_id: str, event: AnyEvent) -> None:
        payload = json.dumps(event.model_dump())
        await self.redis.publish(f"job:{job_id}:channel", payload)      # Pub/Sub
        await self.redis.set(f"job:{job_id}:status", payload, ex=3600)  # Latest status
        if is_terminal(event.model_dump()):
            await self.redis.set(f"job:{job_id}:terminal", "1", ex=3600)

    # Typed convenience methods
    async def progress(self, job_id: str, event: AnyEvent) -> None: ...
    async def complete(self, job_id: str, event: AnyEvent) -> None: ...
    async def error(self, job_id: str, event: AnyEvent) -> None: ...
    async def awaiting_approval(self, job_id: str, event: AnyEvent) -> None: ...

    # Helpers for routes/tasks
    async def set_owner(self, job_id: str, user_id: str, ttl: int = 3600) -> None: ...
    async def get_owner(self, job_id: str) -> str | None: ...
    async def get_latest_status(self, job_id: str) -> dict | None: ...
    async def is_job_terminal(self, job_id: str) -> bool: ...
```

### 5.2 Redis Key Schema

| Key | Type | TTL | Purpose |
|-----|------|-----|---------|
| `job:{job_id}:channel` | Pub/Sub channel | — | Real-time event stream |
| `job:{job_id}:status` | String (JSON) | 1 hour | Latest event for polling/late joiners |
| `job:{job_id}:terminal` | String ("1") | 1 hour | Flag indicating stream ended |
| `job:{job_id}:owner` | String (user_id) | 1 hour | Authorization for SSE access |

---

## 6. Event Types (`app/events/event_types.py`)

### 6.1 Enums

```python
class EventStep(StrEnum):
    QUEUED = "queued"
    TRIAGE = "triage"
    D1_RAG = "d1_rag"
    D2_MEMORY = "d2_memory"
    D4_GOVERNMENT_API = "d4_government_api"
    D4_CREDENTIAL_API = "d4_credential_api"
    D4_HRMS = "d4_hrms"
    D4_OCR = "d4_ocr"
    AWAITING_APPROVAL = "awaiting_approval"
    COMPLETE = "complete"
    ERROR = "error"

class EventStatus(StrEnum):
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"
```

### 6.2 Event Models

```python
class ProgressEvent(BaseModel):
    step: EventStep
    status: EventStatus
    detail: str | None = None

class CompleteEvent(BaseModel):
    step: Literal[EventStep.COMPLETE] = EventStep.COMPLETE
    output: Any

class ErrorEvent(BaseModel):
    step: Literal[EventStep.ERROR] = EventStep.ERROR
    status: Literal[EventStatus.ERROR] = EventStatus.ERROR
    message: str

class AwaitingApprovalEvent(BaseModel):
    step: Literal[EventStep.AWAITING_APPROVAL] = EventStep.AWAITING_APPROVAL
    status: Literal[EventStatus.DONE] = EventStatus.DONE
    report_id: str

AnyEvent = ProgressEvent | CompleteEvent | ErrorEvent | AwaitingApprovalEvent
```

### 6.3 Terminal Detection

```python
def is_terminal(event_dict: dict) -> bool:
    step = event_dict.get("step")
    _terminal = {EventStep.COMPLETE, EventStep.ERROR, EventStep.AWAITING_APPROVAL}
    return step in _terminal
```

---

## 7. SSE Streaming Endpoint (`app/api/routes/chats.py`)

### 7.1 Stream Endpoint

```python
@router.get("/chat/stream/{job_id}")
async def stream_job(
    job_id: str,
    context: RequestContext = Depends(get_request_context),
    publisher: EventPublisher = Depends(get_publisher),
):
    # Authorization check
    owner = await publisher.get_owner(job_id)
    if owner is None or owner != context.user_id:
        raise HTTPException(status_code=403, detail="not authorized for this job")

    async def event_generator():
        pubsub = publisher.redis.pubsub()
        await pubsub.subscribe(f"job:{job_id}:channel")
        try:
            # Send latest status immediately (for late joiners)
            latest = await publisher.get_latest_status(job_id)
            if latest:
                yield f"data: {json.dumps(latest)}\n\n"
                if is_terminal(latest):
                    return

            # Stream loop with heartbeat & timeout
            stream_start = asyncio.get_event_loop().time()
            last_activity = stream_start

            while True:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=1.0
                )
                now = asyncio.get_event_loop().time()

                if message and message["type"] == "message":
                    last_activity = now
                    raw = message["data"]
                    data = raw.decode() if isinstance(raw, bytes) else raw
                    yield f"data: {data}\n\n"
                    if is_terminal(json.loads(data)):
                        break
                else:
                    # Heartbeat
                    if now - last_activity >= 15:
                        yield ": ping\n\n"
                        last_activity = now
                    # Timeout
                    if now - stream_start >= 120:
                        yield f"data: {json.dumps({'step': 'error', 'status': 'error', 'message': 'stream timed out'})}\n\n"
                        break
        finally:
            await pubsub.unsubscribe(f"job:{job_id}:channel")
            await pubsub.close()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
```

### 7.2 Polling Fallback

```python
@router.get("/chat/status/{job_id}")
async def job_status(job_id: str, ...):
    latest = await publisher.get_latest_status(job_id)
    if latest is None:
        return {"status": "processing", "step": None}
    return latest
```

### 7.3 Job Creation & Test Endpoint

```python
@router.post("/chat")
async def chat(req: ChatRequest, context: ..., publisher: ...):
    job_id = str(uuid4())
    await publisher.set_owner(job_id, context.user_id)
    return {"job_id": job_id, "status": "processing"}

@router.post("/publish")  # Test endpoint
async def publish(job_id: str, publisher: ...):
    event = {'step': 'queued', 'status': 'running', 'detail': 'starting'}
    await publisher.publish(job_id, ProgressEvent(**event))
    return True
```

---

## 8. Event Flow Example

### 8.1 Complete Flow (Web → Worker → SSE)

```
1. Client POST /chat {message}
   │
   ▼
2. FastAPI: chat() → job_id = uuid4() → publisher.set_owner(job_id, user_id)
   │                                              │
   │                                              ▼
   │                                       Redis: SET job:{id}:owner = user_id
   │
   ▼
3. Returns {job_id, status: "processing"}
   │
   ▼
4. Client GET /chat/stream/{job_id} (SSE)
   │
   ▼
5. FastAPI: stream_job() → publisher.get_owner(job_id) → OK
   │
   ▼
6. Subscribe to job:{job_id}:channel
   │
   ▼
7. Send latest status (if any)
   │
   ▼
8. Celery task starts (document_pipeline_task)
   │
   ▼
9. Worker: EventPublisher(redis_client).progress(job_id, ProgressEvent(...))
   │                                              │
   │                                              ▼
   │                                       Redis: PUBLISH job:{id}:channel + SET job:{id}:status
   │
   ▼
10. SSE yields event to client
    │
    ▼
11. ... more progress events ...
    │
    ▼
12. Worker: publisher.complete(job_id, CompleteEvent(output={...}))
    │                                              │
    │                                              ▼
    │                                       Redis: PUBLISH + SET + SET terminal flag
    │
    ▼
13. SSE receives terminal event → breaks loop → stream ends
```

### 8.2 Event Payload Examples

**Progress Event:**
```json
{
  "step": "d4_ocr",
  "status": "running",
  "detail": "reading document"
}
```

**Complete Event:**
```json
{
  "step": "complete",
  "status": "done",
  "output": {
    "credential_document_id": "doc-123",
    "credential_id": "cred-456",
    "escalated": []
  }
}
```

**Error Event:**
```json
{
  "step": "error",
  "status": "error",
  "message": "document processing failed"
}
```

---

## 9. Running the System

### 9.1 Prerequisites

```bash
# Redis must be running
docker compose up -d redis

# Or local Redis
redis-server
```

### 9.2 Start FastAPI Server

```bash
uv run uvicorn app.main:app --reload --port 8000
```

### 9.3 Start Celery Worker

```bash
celery -A app.tasks.celery_app worker -l info
```

Expected output:
```
[config]
  . broker: redis://localhost:6379/1
  . registered tasks:
      app.tasks.document_pipeline_task.process_document
      app.tasks.test_task.test_client
```

### 9.4 Test End-to-End

```bash
# 1. Create a job
curl -X POST -H "X-User-Id: <uuid>" -H "X-Org-Id: <uuid>" \
  http://localhost:8000/chat

# 2. Open SSE stream (in another terminal)
curl -N -H "X-User-Id: <uuid>" -H "X-Org-Id: <uuid>" \
  http://localhost:8000/chat/stream/<job_id>

# 3. Publish test event
curl -X POST -H "X-User-Id: <uuid>" -H "X-Org-Id: <uuid>" \
  "http://localhost:8000/publish?job_id=<job_id>"
```

---

## 10. Known Issues & TODOs

| # | Issue | Location | Fix |
|---|-------|----------|-----|
| 1 | ~~Shutdown handler uses `asyncio.run()`~~ | resolved | Superseded by the persistent worker loop (`app/tasks/worker_loop.py`) — see §4 |
| 2 | Channel mismatch in `/publish` | `chats.py:120` | Pass `job_id` not `f'job:{job_id}:channel'` to `publish()` |
| 3 | Owner check blocks SSE if `/chat` not called first | `chats.py:28-30` | Remove or make optional until auth is real |
| 4 | Missing `scopes` in `RequestContext` | `dependencies.py:15-39` | Add `scopes: list[str]` derived from `role` |
| 5 | No `aclose()` on `EventPublisher` | `publisher.py` | Add `async def aclose(self): await self.redis.aclose()` |
| 6 | No user lookup caching | `dependencies.py:78-84` | Cache in Redis with short TTL |

---

## 11. Debugging Commands

### 11.1 Check Redis Keys

```bash
# All job keys
redis-cli KEYS "job:*"

# Specific job status
redis-cli GET "job:<job_id>:status"

# Check owner
redis-cli GET "job:<job_id>:owner"

# Check terminal flag
redis-cli GET "job:<job_id>:terminal"

# Monitor pub/sub in real-time
redis-cli SUBSCRIBE "job:<job_id>:channel"
```

### 11.2 Celery Broker/Result Backend

```bash
# Broker queue (DB 1)
redis-cli -n 1 LRANGE celery 0 -1

# Result backend (DB 2)
redis-cli -n 2 KEYS "celery-task-meta-*"
redis-cli -n 2 GET "celery-task-meta-<uuid>"
```

---

## 12. Future Enhancements

- **Connection pooling**: Configure pool size for high-concurrency workers
- **Reconnection logic**: Handle Redis restarts gracefully in long-running workers
- **Metrics**: Track event latency, dropped messages, connection health
- **Multi-region**: Pub/Sub across Redis clusters for HA
- **Authentication**: Replace header-based auth with JWT + proper scopes