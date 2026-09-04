import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { api, normalizeError } from '@/lib/api'
import type { ReviewResult } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Decision = 'approve' | 'reject'

/**
 * Approve or reject one escalated check.
 *
 * Both decisions are final — the API answers 409 on a second review, because
 * the row records one reviewer's name and overwriting it would erase whose
 * judgment it was. So each click asks once, and says what it will do.
 *
 * Rejecting is the asymmetric one: it also sets the credential to `rejected`,
 * in the same transaction. That is deliberate on the API's side — a reviewer
 * saying "this scan is unreadable" would otherwise move the requirement from
 * `pending` to *satisfied* and leave the clinician more compliant than before
 * anyone looked.
 */
export function ReviewControls({ checkId }: { checkId: string }) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<Decision | null>(null)
  const [note, setNote] = useState('')

  const review = useMutation({
    mutationFn: async (decision: Decision) =>
      (
        await api.post<ReviewResult>(`/document-checks/${checkId}/review`, {
          decision,
          note: note.trim() || undefined,
        })
      ).data,
    onSuccess: (result) => {
      // The queue, the document, the clinician's findings and the roster can
      // all change from one review — a cleared check can move a requirement
      // from pending to satisfied.
      queryClient.invalidateQueries()
      toast.success(
        result.credential_status === 'rejected'
          ? 'Check rejected, and the credential was rejected with it.'
          : `Check ${result.review_status}.`,
      )
    },
    onError: (error) => {
      const { status, message } = normalizeError(error)
      toast.error(
        status === 409 ? 'Somebody else already reviewed this check.' : message,
      )
      if (status === 409) queryClient.invalidateQueries()
      setPending(null)
    },
  })

  if (pending) {
    return (
      <div className="grid gap-3 border border-rule bg-paper/60 p-3">
        <p className="text-sm text-ink">
          {pending === 'approve' ? (
            <>Mark this check as passed? The requirement it holds can then be satisfied.</>
          ) : (
            <>
              Reject this check? <strong className="font-medium">The credential is rejected too</strong>
              , so the clinician stays non-compliant and somebody has to re-upload.
            </>
          )}{' '}
          This cannot be undone.
        </p>

        <div className="grid gap-1.5">
          <Label htmlFor={`note-${checkId}`}>Note (optional)</Label>
          <Input
            id={`note-${checkId}`}
            value={note}
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What did you see? Kept with the check."
          />
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant={pending === 'reject' ? 'danger' : 'default'}
            disabled={review.isPending}
            onClick={() => review.mutate(pending)}
          >
            {review.isPending
              ? 'Saving…'
              : pending === 'approve'
                ? 'Confirm approval'
                : 'Confirm rejection'}
          </Button>
          <Button size="sm" variant="ghost" disabled={review.isPending} onClick={() => setPending(null)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" onClick={() => setPending('approve')}>
        Approve
      </Button>
      <Button size="sm" variant="outline" onClick={() => setPending('reject')}>
        Reject
      </Button>
    </div>
  )
}
