import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { PostHogPageView } from './providers/PostHogProvider'
import { Layout } from './components/shared/Layout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import { Dashboard } from './pages/student/Dashboard'
import { ModuleView } from './pages/student/ModuleView'
import { LessonView } from './pages/student/LessonView'
import { Recordings } from './pages/student/Recordings'
import { Resources } from './pages/student/Resources'
import { Profile } from './pages/student/Profile'
import { AdminDashboard } from './pages/admin/AdminDashboard'
import { StudentDetail } from './pages/admin/StudentDetail'
import { StudentManagement } from './pages/admin/StudentManagement'
import { CohortManagement } from './pages/admin/CohortManagement'
import { CohortDetail } from './pages/admin/CohortDetail'
import { ContentManagement } from './pages/admin/ContentManagement'
import { LessonEditor } from './pages/admin/LessonEditor'
import { Grading } from './pages/admin/Grading'
import { CohortModuleGrading } from './pages/admin/CohortModuleGrading'
import { CohortWatchProgress } from './pages/admin/CohortWatchProgress'
import { StudentWatchProgress } from './pages/admin/StudentWatchProgress'
import { TeamManagement } from './pages/admin/TeamManagement'
import { SignInPage } from './pages/SignIn'
import { UploadProvider } from './contexts/UploadContext'
function AppRoutes() {
  return (
    <>
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
        </Route>

        {/* Staff routes (admin + instructor) */}
        <Route element={<ProtectedRoute requiredRole="staff" />}>
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/students" element={<StudentManagement />} />
          <Route path="/admin/students/:id" element={<StudentDetail />} />
          <Route path="/admin/students/:id/watch-progress" element={<StudentWatchProgress />} />
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
    </>
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
