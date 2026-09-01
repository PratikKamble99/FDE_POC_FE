import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api, normalizeError } from '@/lib/api'
import { CREDENTIAL_TYPES } from '@/lib/types'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { PipelineStepper } from './PipelineStepper'
import { credentialLabel } from '@/lib/format'

/** Queued gives a job id; INLINE_TASKS gives the finished document. */
type UploadResponse = { job_id: string; document_id?: string; status?: string; id?: string }

const IDENTITY = '__identity__'

export function UploadDialog({
  open,
  onOpenChange,
  clinicians,
  lockedClinicianId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  clinicians: { id: string; full_name: string }[]
  lockedClinicianId?: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [clinicianId, setClinicianId] = useState(lockedClinicianId ?? '')
  const [credentialType, setCredentialType] = useState<string>('rn_license')
  const [file, setFile] = useState<File | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [documentId, setDocumentId] = useState<string | null>(null)

  function reset() {
    setJobId(null)
    setDocumentId(null)
    setFile(null)
  }

  const upload = useMutation({
    mutationFn: async () => {
      const form = new FormData()
      form.append('clinician_id', clinicianId)
      form.append('file', file!)
      // Omitted entirely for an identity document: absence is meaningful — it
      // evidences no credential, it exists so face matching has a comparison.
      if (credentialType !== IDENTITY) form.append('credential_type', credentialType)
      return (await api.post<UploadResponse>('/documents/upload', form)).data
    },
    onSuccess: (response) => {
      const id = response.document_id ?? response.id ?? null
      setDocumentId(id)
      if (response.status === 'processing') {
        setJobId(response.job_id)
      } else {
        queryClient.invalidateQueries()
        finish(id)
      }
    },
    onError: (error) => toast.error(normalizeError(error).message),
  })

  function finish(id: string | null) {
    onOpenChange(false)
    reset()
    if (id) navigate(`/documents/${id}`)
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
        <DialogTitle>Upload a credential document</DialogTitle>
        <DialogDescription>
          Say what the document evidences. Your declaration is what the system trusts — the model
          corroborates it and escalates a disagreement rather than overriding you.
        </DialogDescription>

        {jobId ? (
          <div className="mt-6">
            <PipelineStepper
              jobId={jobId}
              onDone={() => {
                queryClient.invalidateQueries()
                finish(documentId)
              }}
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
            <Field label="Clinician" htmlFor="clinician">
              <Select
                value={clinicianId}
                onValueChange={setClinicianId}
                disabled={!!lockedClinicianId}
              >
                <SelectTrigger id="clinician">
                  <SelectValue placeholder="Choose a clinician" />
                </SelectTrigger>
                <SelectContent>
                  {clinicians.map((clinician) => (
                    <SelectItem key={clinician.id} value={clinician.id}>
                      {clinician.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="What it evidences"
              htmlFor="credential-type"
              hint="An identity document evidences no credential; it gives face matching something to compare against."
            >
              <Select value={credentialType} onValueChange={setCredentialType}>
                <SelectTrigger id="credential-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CREDENTIAL_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {credentialLabel(type)}
                    </SelectItem>
                  ))}
                  <SelectItem value={IDENTITY}>Identity document</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="File" htmlFor="file">
              <Input
                id="file"
                type="file"
                accept="image/*,application/pdf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </Field>

            <Button type="submit" disabled={!clinicianId || !file || upload.isPending}>
              {upload.isPending ? 'Uploading…' : 'Upload'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
