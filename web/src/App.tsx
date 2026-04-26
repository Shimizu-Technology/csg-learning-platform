import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { PostHogPageView } from './providers/PostHogProvider'
import { Layout } from './components/shared/Layout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import { LoadingSpinner } from './components/shared/LoadingSpinner'
import { UploadProvider } from './contexts/UploadContext'

const Dashboard = lazy(() => import('./pages/student/Dashboard').then((module) => ({ default: module.Dashboard })))
const ModuleView = lazy(() => import('./pages/student/ModuleView').then((module) => ({ default: module.ModuleView })))
const LessonView = lazy(() => import('./pages/student/LessonView').then((module) => ({ default: module.LessonView })))
const Recordings = lazy(() => import('./pages/student/Recordings').then((module) => ({ default: module.Recordings })))
const Resources = lazy(() => import('./pages/student/Resources').then((module) => ({ default: module.Resources })))
const Profile = lazy(() => import('./pages/student/Profile').then((module) => ({ default: module.Profile })))
const Announcements = lazy(() => import('./pages/shared/Announcements').then((module) => ({ default: module.Announcements })))
const Messages = lazy(() => import('./pages/shared/Messages').then((module) => ({ default: module.Messages })))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard').then((module) => ({ default: module.AdminDashboard })))
const StudentDetail = lazy(() => import('./pages/admin/StudentDetail').then((module) => ({ default: module.StudentDetail })))
const StudentManagement = lazy(() => import('./pages/admin/StudentManagement').then((module) => ({ default: module.StudentManagement })))
const CohortManagement = lazy(() => import('./pages/admin/CohortManagement').then((module) => ({ default: module.CohortManagement })))
const CohortDetail = lazy(() => import('./pages/admin/CohortDetail').then((module) => ({ default: module.CohortDetail })))
const ContentManagement = lazy(() => import('./pages/admin/ContentManagement').then((module) => ({ default: module.ContentManagement })))
const LessonEditor = lazy(() => import('./pages/admin/LessonEditor').then((module) => ({ default: module.LessonEditor })))
const Grading = lazy(() => import('./pages/admin/Grading').then((module) => ({ default: module.Grading })))
const CohortModuleGrading = lazy(() => import('./pages/admin/CohortModuleGrading').then((module) => ({ default: module.CohortModuleGrading })))
const CohortWatchProgress = lazy(() => import('./pages/admin/CohortWatchProgress').then((module) => ({ default: module.CohortWatchProgress })))
const TeamManagement = lazy(() => import('./pages/admin/TeamManagement').then((module) => ({ default: module.TeamManagement })))
const SignInPage = lazy(() => import('./pages/SignIn').then((module) => ({ default: module.SignInPage })))

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
      <UploadProvider>
        <AppRoutes />
      </UploadProvider>
    </BrowserRouter>
  )
}

export default App
