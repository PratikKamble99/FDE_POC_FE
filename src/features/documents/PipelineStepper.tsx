import { useEffect } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { useJobStream, STEP_LABELS } from '@/lib/useJobStream'
import { cn } from '@/lib/cn'

/**
 * The one animated moment in the app, and it is driven entirely by real
 * `EventStep` values off the SSE stream — steps appear as the server reaches
 * them rather than being a scripted sequence.
 *
 * `detail` is a short hand-written label from the server, never raw extracted
 * data: raw output has not passed the egress mask at that point, which is why
 * only the terminal event carries a payload.
 */
export function PipelineStepper({
  jobId,
  onDone,
  labels,
}: {
  jobId: string | null
  onDone?: (output: unknown) => void
  /** Per-step overrides. Policy ingestion publishes every step as `d1_rag`,
   *  where "Retrieving policy" describes the wrong direction of travel. */
  labels?: Record<string, string>
}) {
  const { events, streaming, output, error } = useJobStream(jobId)

  useEffect(() => {
    if (!streaming && (output || error)) onDone?.(output)
    // onDone identity churns on every parent render; the stream's terminal
    // state is the only thing that should re-fire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, output, error])

  return (
    <ol className="grid gap-1.5" aria-live="polite">
      {events.map((event, index) => {
        const failed = event.step === 'error'
        const finished = event.status === 'done' || event.step === 'complete'
        return (
          <li key={index} className="flex items-center gap-2.5 text-sm">
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center border',
                failed
                  ? 'border-state-expired text-state-expired'
                  : finished
                    ? 'border-state-satisfied text-state-satisfied'
                    : 'border-rule text-slate',
              )}
            >
              {failed ? (
                <X className="size-3" />
              ) : finished ? (
                <Check className="size-3" />
              ) : (
                <Loader2 className="size-3 animate-spin" />
              )}
            </span>
            <span className={failed ? 'text-state-expired' : 'text-ink'}>
              {labels?.[event.step] ?? STEP_LABELS[event.step] ?? event.step}
            </span>
            {(event.detail || event.message) && (
              <span className="text-xs text-slate">{event.detail ?? event.message}</span>
            )}
          </li>
        )
      })}

      {events.length === 0 && streaming && (
        <li className="flex items-center gap-2.5 text-sm text-slate">
          <Loader2 className="size-4 animate-spin" />
          Waiting for the pipeline to start…
        </li>
      )}
    </ol>
  )
}
