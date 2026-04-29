import { Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { PostHogPageView } from './providers/PostHogProvider'
import { Layout } from './components/shared/Layout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import { LoadingSpinner } from './components/shared/LoadingSpinner'
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
  LessonEditor,
  LessonView,
  Messages,
  ModuleView,
  Profile,
  Recordings,
  Resources,
  SignInPage,
  StudentDetail,
  StudentManagement,
  TeamManagement,
} from './lib/routePreload'

function AppRoutes() {
  return (
    <Suspense fallback={<LoadingSpinner message="Loading..." />}>
      <PostHogPageView />
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />

        {/* Authenticated routes with shared layout */}
        <Route element={<Layout />}>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/modules/:id" element={<ModuleView />} />
            <Route path="/lessons/:id" element={<LessonView />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/recordings" element={<Recordings />} />
            <Route path="/resources" element={<Resources />} />
            <Route path="/announcements" element={<Announcements />} />
            <Route path="/announcements/:id" element={<Announcements />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/messages/dm/:dmId" element={<Messages />} />
            <Route path="/messages/:channelId" element={<Messages />} />
          </Route>

          {/* Staff routes (admin + instructor) */}
          <Route element={<ProtectedRoute requiredRole="staff" />}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/students" element={<StudentManagement />} />
            <Route path="/admin/students/:id" element={<StudentDetail />} />
            <Route path="/admin/cohorts" element={<CohortManagement />} />
            <Route path="/admin/cohorts/:id" element={<CohortDetail />} />
            <Route path="/admin/cohorts/:id/watch-progress" element={<CohortWatchProgress />} />
            <Route path="/admin/grading" element={<Grading />} />
            <Route path="/admin/cohorts/:cohortId/modules/:moduleId/grading" element={<CohortModuleGrading />} />
          </Route>

          {/* Admin-only routes */}
          <Route element={<ProtectedRoute requiredRole="admin" />}>
            <Route path="/admin/content" element={<ContentManagement />} />
            <Route path="/admin/team" element={<TeamManagement />} />
            <Route path="/admin/lessons/:id/edit" element={<LessonEditor />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
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
