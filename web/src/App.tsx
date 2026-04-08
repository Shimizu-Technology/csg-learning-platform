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
import { StudentManagement } from './pages/admin/StudentManagement'
import { StudentDetail } from './pages/admin/StudentDetail'
import { CohortManagement } from './pages/admin/CohortManagement'
import { CohortDetail } from './pages/admin/CohortDetail'
import { ContentManagement } from './pages/admin/ContentManagement'
import { LessonEditor } from './pages/admin/LessonEditor'
import { Grading } from './pages/admin/Grading'
import { CohortModuleGrading } from './pages/admin/CohortModuleGrading'
import { TeamManagement } from './pages/admin/TeamManagement'
import { SignInPage } from './pages/SignIn'
import { useAuthContext } from './contexts/AuthContext'
import { LoadingSpinner } from './components/shared/LoadingSpinner'

function AppRoutes() {
  const { isLoading } = useAuthContext()

  if (isLoading) {
    return <LoadingSpinner message="Loading..." />
  }

  return (
    <>
    <PostHogPageView />
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />

      {/* Authenticated routes with shared layout */}
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/modules/:id" element={<ModuleView />} />
          <Route path="/lessons/:id" element={<LessonView />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/recordings" element={<Recordings />} />
          <Route path="/resources" element={<Resources />} />
        </Route>
      </Route>

      {/* Staff routes (admin + instructor) */}
      <Route element={<ProtectedRoute requiredRole="staff" />}>
        <Route element={<Layout />}>
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/students/:id" element={<StudentDetail />} />
          <Route path="/admin/cohorts" element={<CohortManagement />} />
          <Route path="/admin/cohorts/:id" element={<CohortDetail />} />
          <Route path="/admin/grading" element={<Grading />} />
          <Route path="/admin/cohorts/:cohortId/modules/:moduleId/grading" element={<CohortModuleGrading />} />
        </Route>
      </Route>

      {/* Admin-only routes */}
      <Route element={<ProtectedRoute requiredRole="admin" />}>
        <Route element={<Layout />}>
          <Route path="/admin/students" element={<StudentManagement />} />
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
      <AppRoutes />
    </BrowserRouter>
  )
}

export default App
