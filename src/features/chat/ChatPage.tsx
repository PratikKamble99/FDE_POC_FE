import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, normalizeError } from '@/lib/api'
import type {
  ChatTurn,
  Citation,
  ConversationDetail,
  ConversationList,
  CreatedConversation,
} from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, PageTitle } from '@/components/states'
import { useAuth } from '@/features/auth/AuthProvider'
import { PipelineStepper } from '@/features/documents/PipelineStepper'
import { formatDateTime, titleize } from '@/lib/format'
import { cn } from '@/lib/cn'

/** The live view of one message. `plan`/`candidates`/`reportId` exist only on
 *  the turn that produced them — a resumed transcript carries text and citations. */
interface Message {
  who: 'you' | 'system'
  text: string
  citations?: Citation[]
  plan?: string[]
  candidates?: ChatTurn['candidates']
  reportId?: string | null
}

/** Queued gives `{job_id, status}`; INLINE_TASKS gives the finished turn. */
type ChatResponse = { job_id: string; status?: 'processing' } & Partial<ChatTurn>

const SUGGESTIONS = [
  'Which credentials is Dr. John missing?',
  'Is this nursing license expired?',
  'Compare the uploaded certificate with government records.',
]

export function ChatPage() {
  const { account } = useAuth()
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  // This user's conversations, server-side and newest first. Owner-scoped by the
  // API, so it survives a reload or a trip to a report without any local copy.
  const { data: history } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => (await api.get<ConversationList>('/chat/conversations')).data,
  })
  const conversations = history?.conversations ?? []

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
        reportId: turn.report_id ?? null,
      },
    ])
    // The turn was persisted server-side; refresh the sidebar so a new thread
    // appears and a continued one moves to the top.
    queryClient.invalidateQueries({ queryKey: ['conversations'] })
  }

  // Landing here starts a *draft*: no session exists until either the first
  // question implicitly mints one, or this button explicitly opens an empty
  // thread. Its id is then sent with every turn that follows.
  const newConversation = useMutation({
    mutationFn: async () =>
      (await api.post<CreatedConversation>('/chat/conversations')).data,
    onSuccess: (created) => {
      setMessages([])
      setDraft('')
      setSessionId(created.session_id)
    },
  })

  // Load one conversation's transcript from the server. Text and citations only —
  // the plan and clarification choices were live-turn state and are not stored.
  async function resume(id: string) {
    if (jobId || ask.isPending) return
    const { data } = await api.get<ConversationDetail>(`/chat/conversations/${id}`)
    setSessionId(data.session_id)
    setMessages(
      data.messages.map((message) => ({
        who: message.role === 'user' ? 'you' : 'system',
        text: message.content,
        citations: message.citations,
      })),
    )
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
        subtitle={
          sessionId
            ? 'This thread carries its own context — a follow-up may say “he” or “that licence”.'
            : 'Nothing is saved yet — your first question opens the thread. Every number in an answer is cited.'
        }
        actions={
          <Button
            variant="outline"
            onClick={() => newConversation.mutate()}
            disabled={!!jobId || ask.isPending || newConversation.isPending}
          >
            New conversation
          </Button>
        }
      />

      <p className="mb-5 flex items-center gap-2 text-xs text-slate">
        <span
          className={cn('h-1.5 w-1.5 rounded-full', sessionId ? 'bg-notary' : 'bg-rule')}
          aria-hidden
        />
        {sessionId ? 'Thread open' : 'Draft — no thread yet'}
      </p>

      {conversations.length > 0 && (
        <details className="mb-5 border border-rule bg-surface">
          <summary className="cursor-pointer px-4 py-2 text-xs text-notary hover:bg-notary-soft">
            Past conversations ({conversations.length})
          </summary>
          <ul className="border-t border-rule">
            {conversations.map((conversation) => (
              <li key={conversation.id} className="border-b border-rule last:border-b-0">
                <button
                  onClick={() => resume(conversation.id)}
                  className={cn(
                    'block w-full px-4 py-2 text-left text-sm hover:bg-paper',
                    conversation.id === sessionId ? 'text-notary' : 'text-ink',
                  )}
                >
                  <span className="block truncate">{conversation.title ?? 'New conversation'}</span>
                  <span className="text-xs text-slate">{formatDateTime(conversation.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

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

              {message.reportId && (
                <p className="border-t border-rule px-4 py-3 text-sm">
                  <Link
                    to={`/reports/${message.reportId}`}
                    className="font-medium text-notary underline-offset-2 hover:underline"
                  >
                    Open the drafted report
                  </Link>
                  <span className="text-slate"> — it is waiting for a person to approve it.</span>
                </p>
              )}

              {/* `text` is the citation — the policy clause, or the board's own
                  word. `reference` is the id or timestamp you look it up by, so
                  it sits underneath rather than standing in for the evidence. */}
              {message.citations && message.citations.length > 0 && (
                <ul className="border-t border-rule bg-paper/50 p-4">
                  {message.citations.map((citation, position) => (
                    <li key={position} className="rail mb-3 last:mb-0">
                      <span className="block font-medium uppercase tracking-[0.08em]">
                        {titleize(citation.source)}
                        {citation.degraded && (
                          <span className="ml-2 normal-case tracking-normal text-state-expiring_soon">
                            registry unreachable — this is stale, not negative
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-ink">{citation.text}</span>
                      {citation.reference && (
                        <span className="mt-0.5 block font-mono text-[0.6875rem] opacity-70">
                          {citation.reference}
                        </span>
                      )}
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
