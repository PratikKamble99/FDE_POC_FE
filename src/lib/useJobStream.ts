import { useEffect, useRef, useState } from 'react'

/** app/events/event_types.py — EventStep, in pipeline order. */
export const PIPELINE_STEPS = [
  'queued',
  'triage',
  'd1_rag',
  'd2_memory',
  'd4_ocr',
  'd4_government_api',
  'd4_credential_api',
  'd4_hrms',
  'd3_compose',
] as const

export const STEP_LABELS: Record<string, string> = {
  queued: 'Queued',
  triage: 'Working out what to read',
  d1_rag: 'Retrieving policy',
  d2_memory: 'Reading records',
  d4_ocr: 'Reading the document',
  d4_government_api: 'Checking the state registry',
  d4_credential_api: 'Checking the credential library',
  d4_hrms: 'Syncing with HRMS',
  d3_compose: 'Composing the answer',
  awaiting_approval: 'Waiting for approval',
  complete: 'Done',
  error: 'Failed',
}

export interface JobEvent {
  step: string
  status?: 'running' | 'done' | 'error'
  detail?: string | null
  message?: string
  output?: unknown
  report_id?: string
}

const TERMINAL = new Set(['complete', 'error', 'awaiting_approval'])

/** Mirrors `is_terminal` in app/events/event_types.py. */
export function isTerminal(event: Pick<JobEvent, 'step'>): boolean {
  return TERMINAL.has(event.step)
}

export interface JobStream {
  events: JobEvent[]
  latest: JobEvent | null
  streaming: boolean
  output: unknown
  error: string | null
}

/**
 * Follows a background job's SSE stream.
 *
 * The route is `/chat/stream/{job_id}` but it is generic — document upload and
 * reverify publish to the same channel and both call `publisher.set_owner`, so
 * the same hook covers all three. EventSource carries cookies on a same-origin
 * request, which is what the Vite proxy buys us.
 */
export function useJobStream(jobId: string | null | undefined): JobStream {
  const [events, setEvents] = useState<JobEvent[]>([])
  const [streaming, setStreaming] = useState(false)
  const [output, setOutput] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    setEvents([])
    setOutput(null)
    setError(null)
    if (!jobId) {
      setStreaming(false)
      return
    }

    setStreaming(true)
    const source = new EventSource(`/api/chat/stream/${jobId}`)
    sourceRef.current = source

    source.onmessage = (message) => {
      let event: JobEvent
      try {
        event = JSON.parse(message.data)
      } catch {
        return
      }
      setEvents((previous) => [...previous, event])

      if (!isTerminal(event)) return
      // The server ends the response here; without closing, EventSource
      // reconnects and replays the terminal event forever.
      source.close()
      setStreaming(false)
      if (event.step === 'error') setError(event.message ?? 'The job failed.')
      else setOutput(event.output ?? event)
    }

    source.onerror = () => {
      // Fired on a clean server-side close too, so only surface it if the job
      // never reached a terminal event.
      if (source.readyState === EventSource.CLOSED) setStreaming(false)
    }

    return () => {
      source.close()
      sourceRef.current = null
    }
  }, [jobId])

  return { events, latest: events.at(-1) ?? null, streaming, output, error }
}
