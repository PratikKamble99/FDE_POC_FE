import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { IssuedLogin } from '@/lib/types'

/** Generated logins are returned once by the API and never again, so this says
 *  so plainly and makes copying the whole set one action. */
export function PasswordsDialog({
  logins,
  onClose,
}: {
  logins: IssuedLogin[] | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copyAll() {
    const text = logins?.map((l) => `${l.email}\t${l.password}`).join('\n') ?? ''
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog
      open={logins !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogTitle>Logins created</DialogTitle>
        <DialogDescription>
          These passwords are shown once and cannot be retrieved later. Copy them now and pass
          them on securely.
        </DialogDescription>

        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-rule text-left">
              <th className="py-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-slate">
                Email
              </th>
              <th className="py-2 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-slate">
                Password
              </th>
            </tr>
          </thead>
          <tbody>
            {logins?.map((login) => (
              <tr key={login.email} className="border-b border-rule last:border-b-0">
                <td className="py-2 pr-3 font-mono text-xs text-ink">{login.email}</td>
                <td className="py-2 font-mono text-xs text-ink">{login.password}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-5 flex gap-2">
          <Button onClick={copyAll} variant="outline">
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy all'}
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
