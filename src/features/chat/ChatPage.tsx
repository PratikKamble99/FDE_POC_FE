import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api, normalizeError } from '@/lib/api'
import type { ChatTurn, Citation } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, PageTitle } from '@/components/states'
import { useAuth } from '@/features/auth/AuthProvider'
import { PipelineStepper } from '@/features/documents/PipelineStepper'
import { titleize } from '@/lib/format'

/** Queued gives `{job_id, status}`; INLINE_TASKS gives the finished turn. */
type ChatResponse = { job_id: string; status?: 'processing' } & Partial<ChatTurn>

interface Message {
  who: 'you' | 'system'
  text: string
  citations?: Citation[]
  plan?: string[]
  candidates?: ChatTurn['candidates']
}

const SUGGESTIONS = [
  'Which credentials is Dr. John missing?',
  'Is this nursing license expired?',
  'Compare the uploaded certificate with government records.',
]

export function ChatPage() {
  const { account } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, jobId])

  function receive(turn: Partial<ChatTurn>) {
    if (turn.session_id) setSessionId(turn.session_id)
    setMessages((previous) => [
      ...previous,
      {
        who: 'system',
        text: turn.answer ?? 'No answer came back for that.',
        citations: turn.citations ?? [],
        plan: turn.plan ?? [],
        candidates: turn.needs_clarification ? (turn.candidates ?? []) : [],
      },
    ])
  }

  const ask = useMutation({
    mutationFn: async (message: string) =>
      (await api.post<ChatResponse>('/chat', { message, session_id: sessionId })).data,
    onSuccess: (response) => {
      if (response.status === 'processing') setJobId(response.job_id)
      else receive(response)
    },
    onError: (error) =>
      setMessages((previous) => [
        ...previous,
        { who: 'system', text: normalizeError(error).message },
      ]),
  })

  function send(message: string) {
    const text = message.trim()
    if (!text || ask.isPending || jobId) return
    setMessages((previous) => [...previous, { who: 'you', text }])
    setDraft('')
    ask.mutate(text)
  }

  // Every turn is grounded against an organization's roster and rules, so an
  // account that belongs to none has nothing to ask about. Posting anyway
  // reaches `uuid.UUID(str(None))` in d2_memory/service.py and 500s.
  if (!account?.org_id) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageTitle title="Ask" />
        <EmptyState title="This login isn't attached to an organization">
          Questions are answered from one organization's roster and approved rules. Sign in as a
          user of the organization you want to ask about.
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle
        title="Ask"
        subtitle="Answers are assembled from indexed records, and every number in one is cited."
      />

      <div className="grid gap-5">
        {messages.length === 0 && (
          <div className="border border-dashed border-rule bg-surface p-6">
            <p className="text-sm text-slate">Try one of these:</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => send(suggestion)}
                  className="border border-rule px-3 py-1.5 text-left text-sm text-ink hover:bg-notary-soft"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) =>
          message.who === 'you' ? (
            <p key={index} className="ml-auto max-w-[85%] bg-notary px-4 py-2.5 text-sm text-white">
              {message.text}
            </p>
          ) : (
            <article key={index} className="border border-rule bg-surface">
              <p className="whitespace-pre-wrap p-4 text-sm leading-relaxed text-ink">
                {message.text}
              </p>

              {/* An ambiguous name gets choices, not another round of free text. */}
              {message.candidates && message.candidates.length > 0 && (
                <div className="border-t border-rule p-4">
                  <p className="mb-2 text-xs text-slate">Which one did you mean?</p>
                  <div className="flex flex-wrap gap-2">
                    {message.candidates.map((candidate) => (
                      <Button
                        key={candidate.id}
                        variant="outline"
                        size="sm"
                        onClick={() => send(candidate.full_name)}
                      >
                        {candidate.full_name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {message.citations && message.citations.length > 0 && (
                <ul className="border-t border-rule bg-paper/50 p-4">
                  {message.citations.map((citation, position) => (
                    <li key={position} className="rail mb-2 last:mb-0">
                      <span className="block font-medium uppercase tracking-[0.08em]">
                        {titleize(citation.source)}
                      </span>
                      <span className="font-mono">{citation.reference}</span>
                    </li>
                  ))}
                </ul>
              )}

              {message.plan && message.plan.length > 0 && (
                <details className="border-t border-rule">
                  <summary className="cursor-pointer px-4 py-2 text-xs text-notary hover:bg-notary-soft">
                    What it read to answer this
                  </summary>
                  <p className="px-4 pb-3 font-mono text-xs text-slate">
                    {message.plan.join(' → ')}
                  </p>
                </details>
              )}
            </article>
          ),
        )}

        {jobId && (
          <div className="border border-rule bg-surface p-4">
            <PipelineStepper
              jobId={jobId}
              onDone={(output) => {
                setJobId(null)
                receive((output ?? {}) as Partial<ChatTurn>)
              }}
            />
          </div>
        )}

        {ask.isPending && !jobId && <p className="text-sm text-slate">Thinking…</p>}
        <div ref={endRef} />
      </div>

      <form
        className="sticky bottom-0 mt-6 flex gap-2 bg-paper py-4"
        onSubmit={(event) => {
          event.preventDefault()
          send(draft)
        }}
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about a clinician, a licence, or a policy requirement"
          aria-label="Your question"
          maxLength={2000}
        />
        <Button type="submit" disabled={!draft.trim() || ask.isPending || !!jobId}>
          Ask
        </Button>
      </form>
    </div>
  )
}
