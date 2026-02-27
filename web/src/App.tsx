import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/shared/Layout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import { Dashboard } from './pages/student/Dashboard'
import { ModuleView } from './pages/student/ModuleView'
import { LessonView } from './pages/student/LessonView'
import { Profile } from './pages/student/Profile'
import { AdminDashboard } from './pages/admin/AdminDashboard'
import { StudentManagement } from './pages/admin/StudentManagement'
import { ContentManagement } from './pages/admin/ContentManagement'
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
