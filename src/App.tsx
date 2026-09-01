import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider, DASHBOARD_ROLES } from '@/features/auth/AuthProvider'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { LoginPage } from '@/features/auth/LoginPage'
import { AppShell } from '@/components/AppShell'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { ClinicianPage, MyRecordPage } from '@/features/clinicians/ClinicianPage'
import { CredentialPage } from '@/features/credentials/CredentialPage'
import { DocumentPage } from '@/features/documents/DocumentPage'
import { ChatPage } from '@/features/chat/ChatPage'
import { TeamPage } from '@/features/org/TeamPage'
import { OnboardOrgPage } from '@/features/admin/OnboardOrgPage'
import { PoliciesPage } from '@/features/policies/PoliciesPage'
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

                <Route element={<RequireAuth roles={DASHBOARD_ROLES} />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/team" element={<TeamPage />} />
                  <Route path="/policies" element={<PoliciesPage />} />
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
