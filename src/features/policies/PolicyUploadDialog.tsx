import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api, normalizeError } from '@/lib/api'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { PipelineStepper } from '@/features/documents/PipelineStepper'
import { titleize } from '@/lib/format'

/**
 * Two shapes, decided by `INLINE_TASKS`:
 *   queued  { job_id, policy_document_id, status: "processing" } — follow the stream
 *   inline  { job_id, ...the finished review payload }
 */
type UploadResponse = { job_id: string; policy_document_id: string; status?: string }

/** `allowed_roles` is the retrieval filter: a policy whose roles exclude the
 *  caller is dropped *before* its text can reach a model's context. Empty means
 *  no restriction beyond the tenant, which is the common case. */
const READER_ROLES = ['clinician', 'hr', 'compliance_officer', 'admin'] as const

export function PolicyUploadDialog({
  open,
  onOpenChange,
  /** Set to upload a revision of this policy rather than a new one. */
  supersedes,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  supersedes?: { id: string; title: string }
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(supersedes?.title ?? '')
  const [jurisdiction, setJurisdiction] = useState('')
  const [version, setVersion] = useState('')
  const [roles, setRoles] = useState<string[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [policyId, setPolicyId] = useState<string | null>(null)

  function reset() {
    setJobId(null)
    setPolicyId(null)
    setFile(null)
  }

  const upload = useMutation({
    mutationFn: async () => {
      const form = new FormData()
      form.append('title', title.trim())
      form.append('file', file!)
      if (jurisdiction.trim()) form.append('jurisdiction', jurisdiction.trim())
      if (version.trim()) form.append('version', version.trim())
      if (roles.length) form.append('allowed_roles', roles.join(','))
      const url = supersedes ? `/policies/${supersedes.id}/versions` : '/policies/upload'
      return (await api.post<UploadResponse>(url, form)).data
    },
    onSuccess: (response) => {
      setPolicyId(response.policy_document_id)
      // Queued: ingestion is chunking, embedding and extracting in a worker.
      if (response.status === 'processing') {
        setJobId(response.job_id)
        return
      }
      finish(response.policy_document_id)
    },
    onError: (error) => toast.error(normalizeError(error).message),
  })

  function finish(id: string | null) {
    onOpenChange(false)
    reset()
    queryClient.invalidateQueries()
    // Straight to review: the rules are proposals until an officer publishes
    // them, and nothing is enforced in the meantime.
    if (id) {
      navigate(`/policies/${id}`, {
        // Only a document uploaded as a version may retire its predecessor, and
        // the review payload does not say which one that is. Carried here so the
        // publish screen can offer it; lost on reload, where retiring the old
        // policy is still a button of its own.
        state: supersedes ? { replaces: supersedes.id } : undefined,
      })
    }
  }

  const busy = upload.isPending || jobId !== null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy || !next) onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent>
        <DialogTitle>{supersedes ? 'Upload a new version' : 'Upload a policy'}</DialogTitle>
        <DialogDescription>
          {supersedes
            ? `The revision is an ordinary draft that knows it replaces “${supersedes.title}”. The old policy keeps running until you publish this one.`
            : 'The document is read, split and searched for credential requirements. Nothing it proposes is enforced until you publish it.'}
        </DialogDescription>

        {jobId ? (
          <div className="mt-6">
            <PipelineStepper
              jobId={jobId}
              labels={{ d1_rag: 'Reading the policy' }}
              onDone={() => finish(policyId)}
            />
          </div>
        ) : (
          <form
            className="mt-6 grid gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              upload.mutate()
            }}
          >
            <Field label="Title" htmlFor="policy-title">
              <Input
                id="policy-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Credentialing policy HR-CRED-004"
              />
            </Field>

            <Field label="File" htmlFor="policy-file">
              <Input
                id="policy-file"
                type="file"
                accept="application/pdf,text/plain,.md,.docx"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Jurisdiction"
                htmlFor="policy-jurisdiction"
                hint="Optional. Blank applies it everywhere."
              >
                <Input
                  id="policy-jurisdiction"
                  value={jurisdiction}
                  onChange={(event) => setJurisdiction(event.target.value)}
                  placeholder="US-CA"
                />
              </Field>

              <Field label="Version" htmlFor="policy-version" hint="Optional. The issuer's own label.">
                <Input
                  id="policy-version"
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  placeholder="2026.1"
                />
              </Field>
            </div>

            <fieldset className="grid gap-1.5">
              <legend className="text-sm font-medium text-ink">Who may read it</legend>
              <p className="text-xs text-slate">
                Leave every box clear for no restriction beyond your organization. A role you exclude
                never has this policy's text retrieved for it at all.
              </p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
                {READER_ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      className="size-4 accent-notary"
                      checked={roles.includes(role)}
                      onChange={(event) =>
                        setRoles((current) =>
                          event.target.checked
                            ? [...current, role]
                            : current.filter((value) => value !== role),
                        )
                      }
                    />
                    {titleize(role)}
                  </label>
                ))}
              </div>
            </fieldset>

            <Button type="submit" disabled={!title.trim() || !file || upload.isPending}>
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
