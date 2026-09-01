import { PageTitle } from '@/components/states'

/**
 * `POST /policies/upload` returns 501 by design — D1 owns everything behind it
 * and is not built. The route exists so the URL and multipart contract are
 * settled; a form here would be a working-looking control that always fails.
 */
export function PoliciesPage() {
  return (
    <div className="max-w-2xl">
      <PageTitle title="Policies" />

      <div className="border border-dashed border-rule bg-surface p-8">
        <p className="font-display text-xl text-ink">Policy upload isn't available yet.</p>
        <p className="mt-3 text-sm leading-relaxed text-slate">
          Uploading a policy will chunk it, embed it, and extract candidate credential rules for a
          compliance officer to approve. Until that pipeline exists, the API answers this endpoint
          with a 501 and the requirement set is seeded directly into the database.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate">
          The rules already in force are the ones cited on every finding — open any clinician to see
          the policy text behind each requirement.
        </p>
      </div>
    </div>
  )
}
