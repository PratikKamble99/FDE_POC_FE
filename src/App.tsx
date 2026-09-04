import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { DASHBOARD_ROLES } from '@/lib/scopes'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { LoginPage } from '@/features/auth/LoginPage'
import { AppShell } from '@/components/AppShell'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { ClinicianPage, MyRecordPage } from '@/features/clinicians/ClinicianPage'
import { CredentialPage } from '@/features/credentials/CredentialPage'
import { DocumentPage } from '@/features/documents/DocumentPage'
import { ChatPage } from '@/features/chat/ChatPage'
import { ReportPage } from '@/features/reports/ReportPage'
import { ReportsPage } from '@/features/reports/ReportsPage'
import { ReviewQueuePage } from '@/features/reviews/ReviewQueuePage'
import { TeamPage } from '@/features/org/TeamPage'
import { OnboardOrgPage } from '@/features/admin/OnboardOrgPage'
import { PoliciesPage } from '@/features/policies/PoliciesPage'
import { PolicyReviewPage } from '@/features/policies/PolicyReviewPage'
import { ApiError } from '@/lib/api'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A 403 or 404 is an answer, not a blip. Only retry what might be one.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400) && count < 2,
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<RequireAuth />}>
              <Route element={<AppShell />}>
                <Route path="/me" element={<MyRecordPage />} />
                <Route path="/clinicians/:clinicianId" element={<ClinicianPage />} />
                <Route path="/credentials/:credentialId" element={<CredentialPage />} />
                <Route path="/documents/:documentId" element={<DocumentPage />} />
                <Route path="/chat" element={<ChatPage />} />
                {/* Every role holds compliance:read; the route additionally
                    holds a clinician to reports about themselves, and answers
                    403 if they try otherwise. */}
                <Route path="/reports/:reportId" element={<ReportPage />} />

                {/* Every role that holds compliance:read at all — which is
                    everyone except a super admin, who holds no compliance
                    scope. The list is per-login and the API re-checks each
                    read, so a clinician sees only their own either way. */}
                <Route element={<RequireAuth scope="compliance:read" />}>
                  <Route path="/reports" element={<ReportsPage />} />
                </Route>

                <Route element={<RequireAuth roles={DASHBOARD_ROLES} />}>
                  <Route path="/" element={<DashboardPage />} />
                </Route>

                {/* Every policy route gates on `compliance:report` — admin and
                    compliance officer. Loading the corpus decides what the whole
                    organization is measured against, so it is not an HR-level
                    action, and HR is in DASHBOARD_ROLES. */}
                <Route element={<RequireAuth scope="compliance:report" />}>
                  <Route path="/policies" element={<PoliciesPage />} />
                  <Route path="/policies/:policyId" element={<PolicyReviewPage />} />
                </Route>

                {/* `users:create` covers both provisioning routes, and HR holds
                    it. See scopes.ts — the staff tab inside is narrower. */}
                <Route element={<RequireAuth scope="users:create" />}>
                  <Route path="/team" element={<TeamPage />} />
                </Route>

                {/* Reviewing a check is a judgment about whether a document was
                    read correctly, not a compliance decision — hence
                    documents:update, which includes HR, who upload on
                    clinicians' behalf and clear their own escalations. */}
                <Route element={<RequireAuth scope="documents:update" />}>
                  <Route path="/reviews" element={<ReviewQueuePage />} />
                </Route>

                <Route element={<RequireAuth roles={['super_admin']} />}>
                  <Route path="/admin/organizations/new" element={<OnboardOrgPage />} />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  )
}
