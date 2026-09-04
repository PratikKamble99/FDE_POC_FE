import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api, normalizeError } from '@/lib/api'
import { CLINICAL_ROLES, type IssuedLogin } from '@/lib/types'
import { useAuth } from '@/features/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { PageTitle } from '@/components/states'
import { PasswordsDialog } from '@/components/PasswordsDialog'
import { titleize } from '@/lib/format'
import { cn } from '@/lib/cn'

// The API's UserEntry regex accepts only these two — a clinician login is
// created through the clinicians endpoint, which also makes the clinician row.
const userSchema = z.object({
  users: z
    .array(
      z.object({
        email: z.string().min(1, 'Required').email('Not a valid email address'),
        full_name: z.string().min(1, 'Required'),
        role: z.enum(['hr', 'compliance_officer']),
      }),
    )
    .min(1),
})

const clinicianSchema = z.object({
  clinicians: z
    .array(
      z.object({
        full_name: z.string().min(1, 'Required'),
        clinical_role: z.string().min(1, 'Required'),
        jurisdiction: z.string().optional(),
        npi: z.string().optional(),
        email: z.string().email('Not a valid email address').optional().or(z.literal('')),
      }),
    )
    .min(1),
})

export function TeamPage() {
  const [tab, setTab] = useState<'clinicians' | 'users'>('clinicians')
  const [issued, setIssued] = useState<IssuedLogin[] | null>(null)

  // Both tabs post to routes gated on `users:create`, which only admin holds —
  // and the route guard on /team checks the same scope, so anyone who reaches
  // this page can use either tab. No second gate needed here.
  const tabs = ['clinicians', 'users'] as const

  return (
    <>
      <PageTitle
        title="Team"
        subtitle="Add the people this organization tracks. Each one gets a login, shown once."
      />

      <div className="mb-6 flex border-b border-rule">
        {tabs.map((name) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm',
              tab === name
                ? 'border-notary font-medium text-notary'
                : 'border-transparent text-slate hover:text-ink',
            )}
          >
            {name === 'clinicians' ? 'Clinicians' : 'HR & compliance'}
          </button>
        ))}
      </div>

      {tab === 'clinicians' ? (
        <AddClinicians onIssued={setIssued} />
      ) : (
        <AddUsers onIssued={setIssued} />
      )}

      <PasswordsDialog logins={issued} onClose={() => setIssued(null)} />
    </>
  )
}

function AddClinicians({ onIssued }: { onIssued: (logins: IssuedLogin[]) => void }) {
  const { account } = useAuth()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<string | null>(null)

  const form = useForm<z.infer<typeof clinicianSchema>>({
    resolver: zodResolver(clinicianSchema),
    defaultValues: {
      clinicians: [{ full_name: '', clinical_role: 'nurse', jurisdiction: '', npi: '', email: '' }],
    },
  })
  const rows = useFieldArray({ control: form.control, name: 'clinicians' })

  const create = useMutation({
    mutationFn: async (values: z.infer<typeof clinicianSchema>) =>
      (
        await api.post<IssuedLogin[]>(`/organizations/${account!.org_id}/clinicians`, {
          // Empty optional strings would fail the API's EmailStr validation.
          clinicians: values.clinicians.map((c) => ({
            ...c,
            email: c.email || null,
            jurisdiction: c.jurisdiction || null,
            npi: c.npi || null,
          })),
        })
      ).data,
    onSuccess: (logins) => {
      onIssued(logins)
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      form.reset()
      rows.replace([{ full_name: '', clinical_role: 'nurse', jurisdiction: '', npi: '', email: '' }])
    },
    onError: (error) => setFailure(normalizeError(error).message),
  })

  return (
    <form
      onSubmit={form.handleSubmit((values) => {
        // The endpoint is all-or-nothing, so the whole array is validated before
        // anything is sent — a half-created roster is not a state to land in.
        setFailure(null)
        create.mutate(values)
      })}
      className="grid gap-4"
    >
      {rows.fields.map((row, index) => (
        <fieldset key={row.id} className="grid gap-3 border border-rule bg-surface p-4 sm:grid-cols-5">
          <legend className="sr-only">Clinician {index + 1}</legend>

          <Field
            label="Full name"
            htmlFor={`c-name-${index}`}
            error={form.formState.errors.clinicians?.[index]?.full_name?.message}
          >
            <Input id={`c-name-${index}`} {...form.register(`clinicians.${index}.full_name`)} />
          </Field>

          <Field label="Clinical role" htmlFor={`c-role-${index}`}>
            <select
              id={`c-role-${index}`}
              className="h-9 border border-rule bg-surface px-3 text-sm text-ink"
              {...form.register(`clinicians.${index}.clinical_role`)}
            >
              {CLINICAL_ROLES.map((role) => (
                <option key={role} value={role}>
                  {titleize(role)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Jurisdiction" htmlFor={`c-juris-${index}`} hint="e.g. CA">
            <Input id={`c-juris-${index}`} {...form.register(`clinicians.${index}.jurisdiction`)} />
          </Field>

          <Field label="NPI" htmlFor={`c-npi-${index}`}>
            <Input id={`c-npi-${index}`} {...form.register(`clinicians.${index}.npi`)} />
          </Field>

          <div className="flex items-end gap-2">
            <Field
              label="Email"
              htmlFor={`c-email-${index}`}
              error={form.formState.errors.clinicians?.[index]?.email?.message}
            >
              <Input id={`c-email-${index}`} {...form.register(`clinicians.${index}.email`)} />
            </Field>
            {rows.fields.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => rows.remove(index)}
                aria-label={`Remove clinician ${index + 1}`}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        </fieldset>
      ))}

      {failure && (
        <p role="alert" className="border-l-2 border-state-expired pl-3 text-sm text-state-expired">
          {failure} Nothing was created — fix it and send the whole set again.
        </p>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            rows.append({ full_name: '', clinical_role: 'nurse', jurisdiction: '', npi: '', email: '' })
          }
        >
          <Plus /> Add another
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : `Create ${rows.fields.length}`}
        </Button>
      </div>
    </form>
  )
}

function AddUsers({ onIssued }: { onIssued: (logins: IssuedLogin[]) => void }) {
  const { account } = useAuth()
  const [failure, setFailure] = useState<string | null>(null)

  const form = useForm<z.infer<typeof userSchema>>({
    resolver: zodResolver(userSchema),
    defaultValues: { users: [{ email: '', full_name: '', role: 'hr' }] },
  })
  const rows = useFieldArray({ control: form.control, name: 'users' })

  const create = useMutation({
    mutationFn: async (values: z.infer<typeof userSchema>) =>
      (await api.post<IssuedLogin[]>(`/organizations/${account!.org_id}/users`, values)).data,
    onSuccess: (logins) => {
      onIssued(logins)
      form.reset()
      rows.replace([{ email: '', full_name: '', role: 'hr' }])
    },
    onError: (error) => setFailure(normalizeError(error).message),
  })

  return (
    <form
      onSubmit={form.handleSubmit((values) => {
        setFailure(null)
        create.mutate(values)
      })}
      className="grid gap-4"
    >
      {rows.fields.map((row, index) => (
        <fieldset key={row.id} className="grid gap-3 border border-rule bg-surface p-4 sm:grid-cols-3">
          <legend className="sr-only">Person {index + 1}</legend>

          <Field
            label="Full name"
            htmlFor={`u-name-${index}`}
            error={form.formState.errors.users?.[index]?.full_name?.message}
          >
            <Input id={`u-name-${index}`} {...form.register(`users.${index}.full_name`)} />
          </Field>

          <Field
            label="Email"
            htmlFor={`u-email-${index}`}
            error={form.formState.errors.users?.[index]?.email?.message}
          >
            <Input id={`u-email-${index}`} {...form.register(`users.${index}.email`)} />
          </Field>

          <div className="flex items-end gap-2">
            <Field label="Role" htmlFor={`u-role-${index}`}>
              <select
                id={`u-role-${index}`}
                className="h-9 w-full border border-rule bg-surface px-3 text-sm text-ink"
                {...form.register(`users.${index}.role`)}
              >
                <option value="hr">HR</option>
                <option value="compliance_officer">Compliance officer</option>
              </select>
            </Field>
            {rows.fields.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => rows.remove(index)}
                aria-label={`Remove person ${index + 1}`}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        </fieldset>
      ))}

      {failure && (
        <p role="alert" className="border-l-2 border-state-expired pl-3 text-sm text-state-expired">
          {failure}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => rows.append({ email: '', full_name: '', role: 'hr' })}
        >
          <Plus /> Add another
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : `Create ${rows.fields.length}`}
        </Button>
      </div>
    </form>
  )
}
