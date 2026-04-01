import { BrowserRouter, Routes, Route } from 'react-router-dom'
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
import { CohortDetail } from './pages/admin/CohortDetail'
import { ContentManagement } from './pages/admin/ContentManagement'
import { LessonEditor } from './pages/admin/LessonEditor'
import { Grading } from './pages/admin/Grading'
import { SignInPage } from './pages/SignIn'
import { useAuthContext } from './contexts/AuthContext'
import { LoadingSpinner } from './components/shared/LoadingSpinner'

function AppRoutes() {
  const { isLoading } = useAuthContext()

  if (isLoading) {
    return <LoadingSpinner message="Loading..." />
  }

  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />

      {/* Student routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout>
              <Dashboard />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/modules/:id"
        element={
          <ProtectedRoute>
            <Layout>
              <ModuleView />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/lessons/:id"
        element={
          <ProtectedRoute>
            <Layout>
              <LessonView />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <Layout>
              <Profile />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/recordings"
        element={
          <ProtectedRoute>
            <Layout>
              <Recordings />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/resources"
        element={
          <ProtectedRoute>
            <Layout>
              <Resources />
            </Layout>
          </ProtectedRoute>
        }
      />

      {/* Admin routes */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute requiredRole="staff">
            <Layout>
              <AdminDashboard />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/students"
        element={
          <ProtectedRoute requiredRole="staff">
            <Layout>
              <StudentManagement />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/students/:id"
        element={
          <ProtectedRoute requiredRole="staff">
            <Layout>
              <StudentDetail />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/cohorts/:id"
        element={
          <ProtectedRoute requiredRole="staff">
            <Layout>
              <CohortDetail />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/content"
        element={
          <ProtectedRoute requiredRole="staff">
            <Layout>
              <ContentManagement />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/grading"
        element={
          <ProtectedRoute requiredRole="staff">
            <Layout>
              <Grading />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/lessons/:id/edit"
        element={
          <ProtectedRoute requiredRole="staff">
            <Layout>
              <LessonEditor />
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
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
