import { NotFoundRoute } from './components/shared/NotFound'
import { NoAccess } from './components/shared/NoAccess'
import { RouteErrorBoundary } from './components/shared/AppErrorBoundary'
import { CohortSettingsEntry } from './pages/admin/CohortSettingsEntry'
import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { createBrowserRouter, RouterProvider, Navigate, Routes, Route, useLocation } from 'react-router-dom'
import { applySurface, invitationDestination } from './lib/brand'
import { documentTitleForPath } from './lib/pageTitles'
import { useAuthContext } from './contexts/AuthContext'
import { HomePage } from './pages/Home'
import { PostHogPageView } from './providers/PostHogProvider'
import { Layout } from './components/shared/Layout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import { LoadingSpinner } from './components/shared/LoadingSpinner'
import { MessagesLoadingShell } from './components/shared/MessagesLoadingShell'
import { AuthLoadingShell } from './components/auth/AuthLoadingShell'
import { UploadProvider } from './contexts/UploadContext'
import { CohortProvider } from './contexts/CohortContext'
import { ToastProvider } from './contexts/ToastContext'
import { ConfirmProvider } from './contexts/ConfirmContext'
import { LeaveGuardProvider } from './lib/useLeaveGuard'
import {
  AdminDashboard,
  AdminActivity,
  Announcements,
  CohortWorkspace,
  CohortManagement,
  CohortModuleGrading,
  CohortStudentView,
  CohortWatchProgress,
  ContentManagement,
  Dashboard,
  PrivateMeetings,
  StaffPrivateMeetings,
  Grading,
  LessonEditor,
  LessonRecord,
  CurriculumRecord,
  ModuleRecord,
  LessonView,
  Materials,
  Messages,
  ModuleView,
  Profile,
  Recordings,
  Resources,
  SignInPage,
  SignUpPage,
  StudentDetail,
  StudentWorkspace,
  SubmissionDetail,
  StudentManagement,
  SupportQueue,
  Moderation,
  InterventionDetail,
  HelpRequestDetail,
  TeamManagement,
  TeamMemberDetail,
} from './lib/routePreload'
import { AccountDeletionPage, PrivacyPolicyPage, TermsPage } from './pages/Legal'
import { StudentCohortHome } from './pages/student/StudentCohortHome'
import { CourseCatalog } from './pages/CourseCatalog'

export function RouteLoadingFallback() {
  const location = useLocation()

  if (location.pathname.startsWith('/messages')) {
    return <MessagesLoadingShell />
  }

  if (/^\/sign-(in|up)(\/|$)/.test(location.pathname)) {
    return <AuthLoadingShell />
  }

  return <LoadingSpinner message="Loading..." />
}

function SuspendedRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>
}

export function RouteTitle() {
  const location = useLocation()

  useEffect(() => {
    document.title = documentTitleForPath(location.pathname)
    applySurface(location.pathname)
  }, [location.pathname])

  return null
}

/**
 * Show marketing immediately while Clerk loads, then take signed-in visitors
 * to Today. Clerk invitation links arrive here with a ticket and are
 * forwarded to the sign-up or sign-in page that can accept it.
 */
export function HomeRoute() {
  const { isSignedIn, isLoading } = useAuthContext()
  const location = useLocation()
  const destination = invitationDestination(location.search)
  if (destination) return <Navigate to={destination} replace />
  if (!isLoading && isSignedIn) return <Navigate to="/dashboard" replace />
  return <HomePage />
}

function AppRoutes() {
  return (
    <>
      <PostHogPageView />
      <RouteTitle />
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/courses" element={<CourseCatalog />} />
        <Route path="/sign-in" element={<SuspendedRoute><SignInPage /></SuspendedRoute>} />
        <Route path="/sign-up" element={<SuspendedRoute><SignUpPage /></SuspendedRoute>} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/account-deletion" element={<AccountDeletionPage />} />

        <Route element={<ProtectedRoute requiredRole="staff" noAccessElement={<Layout><NoAccess /></Layout>} />}>
          <Route path="/admin/cohorts/:id/student-view/*" element={<SuspendedRoute><CohortStudentView /></SuspendedRoute>} />
        </Route>

        {/* Authenticated routes with shared layout */}
        <Route element={<Layout />}>
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<SuspendedRoute><Dashboard /></SuspendedRoute>} />
            <Route path="/cohorts/:id" element={<StudentCohortHome />} />
            <Route path="/meetings" element={<SuspendedRoute><PrivateMeetings /></SuspendedRoute>} />
            <Route path="/materials" element={<SuspendedRoute><Materials /></SuspendedRoute>} />
            <Route path="/modules/:id" element={<SuspendedRoute><ModuleView /></SuspendedRoute>} />
            <Route path="/lessons/:id" element={<SuspendedRoute><LessonView /></SuspendedRoute>} />
            <Route path="/profile" element={<SuspendedRoute><Profile /></SuspendedRoute>} />
            <Route path="/recordings" element={<SuspendedRoute><Recordings /></SuspendedRoute>} />
            <Route path="/resources" element={<SuspendedRoute><Resources /></SuspendedRoute>} />
            <Route path="/announcements" element={<SuspendedRoute><Announcements /></SuspendedRoute>} />
            <Route path="/announcements/:id" element={<SuspendedRoute><Announcements /></SuspendedRoute>} />
            <Route path="/messages" element={<SuspendedRoute><Messages /></SuspendedRoute>} />
            <Route path="/messages/dm/:dmId" element={<SuspendedRoute><Messages /></SuspendedRoute>} />
            <Route path="/messages/:channelId" element={<SuspendedRoute><Messages /></SuspendedRoute>} />
          </Route>

          {/* Staff routes (admin + instructor) */}
          <Route element={<ProtectedRoute requiredRole="staff" />}>
            <Route path="/admin" element={<SuspendedRoute><AdminDashboard /></SuspendedRoute>} />
            <Route path="/admin/meetings" element={<SuspendedRoute><StaffPrivateMeetings /></SuspendedRoute>} />
            <Route path="/admin/students" element={<SuspendedRoute><StudentManagement /></SuspendedRoute>} />
            <Route path="/admin/students/:id" element={<SuspendedRoute><StudentDetail /></SuspendedRoute>} />
            <Route path="/admin/cohorts/:cohortId/students/:id/:tab?" element={<SuspendedRoute><StudentWorkspace /></SuspendedRoute>} />
            <Route path="/admin/cohorts" element={<SuspendedRoute><CohortManagement /></SuspendedRoute>} />
            <Route path="/admin/cohorts/:id/settings" element={<CohortSettingsEntry />} />
            <Route path="/admin/cohorts/:id" element={<SuspendedRoute><CohortWorkspace /></SuspendedRoute>} />
            <Route path="/admin/cohorts/:id/watch-progress" element={<SuspendedRoute><CohortWatchProgress /></SuspendedRoute>} />
            <Route path="/admin/grading" element={<SuspendedRoute><Grading /></SuspendedRoute>} />
            <Route path="/admin/submissions/:id" element={<SuspendedRoute><SubmissionDetail /></SuspendedRoute>} />
            <Route path="/admin/support" element={<SuspendedRoute><SupportQueue /></SuspendedRoute>} />
            <Route path="/admin/help-requests/:id" element={<SuspendedRoute><HelpRequestDetail /></SuspendedRoute>} />
            <Route path="/admin/interventions/:id" element={<SuspendedRoute><InterventionDetail /></SuspendedRoute>} />
            <Route path="/admin/cohorts/:cohortId/modules/:moduleId/grading" element={<SuspendedRoute><CohortModuleGrading /></SuspendedRoute>} />
            <Route path="/admin/content" element={<SuspendedRoute><ContentManagement /></SuspendedRoute>} />
            <Route path="/admin/curricula/:id" element={<SuspendedRoute><CurriculumRecord /></SuspendedRoute>} />
            <Route path="/admin/modules/:id" element={<SuspendedRoute><ModuleRecord /></SuspendedRoute>} />
            <Route path="/admin/lessons/:id" element={<SuspendedRoute><LessonRecord /></SuspendedRoute>} />
            <Route path="/admin/lessons/:id/edit" element={<SuspendedRoute><LessonEditor /></SuspendedRoute>} />
          </Route>

          {/* Admin-only routes */}
          <Route element={<ProtectedRoute requiredRole="admin" />}>
            <Route path="/admin/activity" element={<SuspendedRoute><AdminActivity /></SuspendedRoute>} />
            <Route path="/admin/moderation" element={<SuspendedRoute><Moderation /></SuspendedRoute>} />
            <Route path="/admin/team" element={<SuspendedRoute><TeamManagement /></SuspendedRoute>} />
            <Route path="/admin/team/:id" element={<SuspendedRoute><TeamMemberDetail /></SuspendedRoute>} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundRoute />} />
      </Routes>
    </>
  )
}

// Data router enables navigation blockers, including browser Back/Forward. LeaveGuardProvider owns
// the router's one blocker; unsaved editors register with it through useLeaveGuard.
const makeRouter = () => createBrowserRouter([{
  errorElement: <RouteErrorBoundary />,
  path: '*',
  element: (
    <LeaveGuardProvider>
      <ToastProvider>
        <ConfirmProvider>
          <UploadProvider>
            <CohortProvider><AppRoutes /></CohortProvider>
          </UploadProvider>
        </ConfirmProvider>
      </ToastProvider>
    </LeaveGuardProvider>
  ),
}])

function App() {
  const [router] = useState(makeRouter)
  return <RouterProvider router={router} />
}

export default App
