import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { api, normalizeError } from '@/lib/api'
import type { IssuedLogin } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { PageTitle } from '@/components/states'
import { PasswordsDialog } from '@/components/PasswordsDialog'

const schema = z.object({
  name: z.string().min(1, 'Required'),
  email: z.string().min(1, 'Required').email('Not a valid email address'),
  phone: z.string().optional(),
  // valueAsNumber on the input, not z.coerce — coerce widens the schema's input
  // type to unknown, which then fights react-hook-form's field types.
  no_of_employees: z
    .number({ invalid_type_error: 'Enter a number' })
    .int('Whole numbers only')
    .min(1, 'At least 1')
    .max(10000, 'At most 10,000'),
  admin_name: z.string().min(1, 'Required'),
  admin_email: z.string().min(1, 'Required').email('Not a valid email address'),
})

interface OnboardResponse {
  org_id: string
  name: string
  admin_email: string
  created_at: string
  status: string
  password: string
}

export function OnboardOrgPage() {
  const [issued, setIssued] = useState<IssuedLogin[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })

  const onboard = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) =>
      (
        await api.post<OnboardResponse>('/admin/onboardOrg', {
          ...values,
          phone: values.phone || null,
        })
      ).data,
    onSuccess: (org) => {
      setIssued([{ email: org.admin_email, password: org.password, status: org.status }])
      reset()
    },
    onError: (error) => setFailure(normalizeError(error).message),
  })

  return (
    <div className="max-w-2xl">
      <PageTitle
        title="Onboard an organization"
        subtitle="Creates the organization and its first admin login. That admin is then the only account that can add people to it."
      />

      <form
        onSubmit={handleSubmit((values) => {
          setFailure(null)
          onboard.mutate(values)
        })}
        noValidate
        className="grid gap-5 border border-rule bg-surface p-6"
      >
        <Field label="Organization name" htmlFor="name" error={errors.name?.message}>
          <Input id="name" {...register('name')} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Organization email" htmlFor="email" error={errors.email?.message}>
            <Input id="email" type="email" {...register('email')} />
          </Field>
          <Field label="Phone" htmlFor="phone" hint="Optional">
            <Input id="phone" {...register('phone')} />
          </Field>
        </div>

        <Field
          label="Employees"
          htmlFor="no_of_employees"
          error={errors.no_of_employees?.message}
          hint="Between 1 and 10,000"
        >
          <Input
            id="no_of_employees"
            type="number"
            min={1}
            max={10000}
            {...register('no_of_employees', { valueAsNumber: true })}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Admin name" htmlFor="admin_name" error={errors.admin_name?.message}>
            <Input id="admin_name" {...register('admin_name')} />
          </Field>
          <Field label="Admin email" htmlFor="admin_email" error={errors.admin_email?.message}>
            <Input id="admin_email" type="email" {...register('admin_email')} />
          </Field>
        </div>

        {failure && (
          <p role="alert" className="border-l-2 border-state-expired pl-3 text-sm text-state-expired">
            {failure}
          </p>
        )}

        <Button type="submit" disabled={isSubmitting || onboard.isPending}>
          {onboard.isPending ? 'Creating…' : 'Create the organization'}
        </Button>
      </form>

      <PasswordsDialog logins={issued} onClose={() => setIssued(null)} />
    </div>
  )
}
