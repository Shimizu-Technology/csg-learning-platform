import { Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Routes, Route, useLocation } from 'react-router-dom'
import { PostHogPageView } from './providers/PostHogProvider'
import { Layout } from './components/shared/Layout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import { LoadingSpinner } from './components/shared/LoadingSpinner'
import { MessagesLoadingShell } from './components/shared/MessagesLoadingShell'
import { UploadProvider } from './contexts/UploadContext'
import { ToastProvider } from './contexts/ToastContext'
import {
  AdminDashboard,
  Announcements,
  CohortDetail,
  CohortManagement,
  CohortModuleGrading,
  CohortWatchProgress,
  ContentManagement,
  Dashboard,
  Grading,
  HomePage,
  LessonEditor,
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
  StudentManagement,
  StudentPreview,
  TeamManagement,
} from './lib/routePreload'

function RouteLoadingFallback() {
  const location = useLocation()

  if (location.pathname.startsWith('/messages')) {
    return <MessagesLoadingShell />
  }

  return <LoadingSpinner message="Loading..." />
}

function SuspendedRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>
}

function AppRoutes() {
  return (
    <>
      <PostHogPageView />
      <Routes>
        <Route path="/" element={<SuspendedRoute><HomePage /></SuspendedRoute>} />
        <Route path="/sign-in" element={<SuspendedRoute><SignInPage /></SuspendedRoute>} />
        <Route path="/sign-up" element={<SuspendedRoute><SignUpPage /></SuspendedRoute>} />

        {/* Authenticated routes with shared layout */}
        <Route element={<Layout />}>
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<SuspendedRoute><Dashboard /></SuspendedRoute>} />
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
            <Route path="/admin/students" element={<SuspendedRoute><StudentManagement /></SuspendedRoute>} />
            <Route path="/admin/students/:id" element={<SuspendedRoute><StudentDetail /></SuspendedRoute>} />
            <Route path="/admin/students/:id/preview" element={<SuspendedRoute><StudentPreview /></SuspendedRoute>} />
            <Route path="/admin/cohorts" element={<SuspendedRoute><CohortManagement /></SuspendedRoute>} />
            <Route path="/admin/cohorts/:id" element={<SuspendedRoute><CohortDetail /></SuspendedRoute>} />
            <Route path="/admin/cohorts/:id/watch-progress" element={<SuspendedRoute><CohortWatchProgress /></SuspendedRoute>} />
            <Route path="/admin/grading" element={<SuspendedRoute><Grading /></SuspendedRoute>} />
            <Route path="/admin/cohorts/:cohortId/modules/:moduleId/grading" element={<SuspendedRoute><CohortModuleGrading /></SuspendedRoute>} />
          </Route>

          {/* Admin-only routes */}
          <Route element={<ProtectedRoute requiredRole="admin" />}>
            <Route path="/admin/content" element={<SuspendedRoute><ContentManagement /></SuspendedRoute>} />
            <Route path="/admin/team" element={<SuspendedRoute><TeamManagement /></SuspendedRoute>} />
            <Route path="/admin/lessons/:id/edit" element={<SuspendedRoute><LessonEditor /></SuspendedRoute>} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <UploadProvider>
          <AppRoutes />
        </UploadProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}

export default App
