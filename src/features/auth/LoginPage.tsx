import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { normalizeError } from '@/lib/api'
import { useAuth, homeFor } from './AuthProvider'

const schema = z.object({
  email: z.string().min(1, 'Enter your email address').email('That is not a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [failure, setFailure] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFailure(null)
    try {
      const account = await signIn(email, password)
      navigate(homeFor(account), { replace: true })
    } catch (error) {
      setFailure(normalizeError(error).message)
    }
  })

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_28rem]">
      {/* The thesis, not a stock illustration: what the product actually
          promises is that no claim stands without a source. */}
      <section className="hidden flex-col justify-between bg-ink p-12 text-paper lg:flex">
        <p className="text-[0.6875rem] uppercase tracking-[0.18em] text-paper/50">
          Credential Registry
        </p>
        <div className="max-w-lg">
          <h1 className="font-display text-5xl leading-[1.05]">
            Every compliance claim points at its source.
          </h1>
          <p className="mt-6 text-sm leading-relaxed text-paper/70">
            Licences are read, checked against the issuing authority, and measured against your own
            approved policy. What the document says, what the board says, and what we concluded
            stay three separate answers — so a decision made today is still defensible a year from
            now.
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-6 border-t border-paper/15 pt-6 text-xs">
          {[
            ['Read', 'OCR and field extraction'],
            ['Verify', 'Against the state registry'],
            ['Cite', 'Every requirement to policy text'],
          ].map(([term, description]) => (
            <div key={term}>
              <dt className="font-mono uppercase tracking-[0.08em] text-paper/50">{term}</dt>
              <dd className="mt-1 text-paper/80">{description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex items-center justify-center bg-surface p-8">
        <form onSubmit={onSubmit} noValidate className="w-full max-w-sm">
          <h2 className="font-display text-3xl text-ink">Sign in</h2>
          <p className="mt-2 text-sm text-slate">Use the credentials issued to you.</p>

          <div className="mt-8 grid gap-5">
            <Field label="Email" htmlFor="email" error={errors.email?.message}>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                aria-invalid={!!errors.email}
                {...register('email')}
              />
            </Field>

            <Field label="Password" htmlFor="password" error={errors.password?.message}>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!errors.password}
                {...register('password')}
              />
            </Field>

            {failure && (
              <p role="alert" className="border-l-2 border-state-expired pl-3 text-sm text-state-expired">
                {failure}
              </p>
            )}

            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </div>
        </form>
      </section>
    </main>
  )
}
