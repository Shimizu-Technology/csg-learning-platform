import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

type ModuleWithDefault<T extends ComponentType<unknown>> = Promise<{ default: T }>
type Loader<T extends ComponentType<unknown>> = () => ModuleWithDefault<T>
type LazyWithPreload<T extends ComponentType<unknown>> = LazyExoticComponent<T> & {
  preload: () => ModuleWithDefault<T>
}

function lazyWithPreload<T extends ComponentType<unknown>>(loader: Loader<T>): LazyWithPreload<T> {
  const Component = lazy(loader) as LazyWithPreload<T>
  Component.preload = loader
  return Component
}

const dashboardLoader = () => import('../pages/student/Dashboard').then((module) => ({ default: module.DashboardRoute }))
const homeLoader = () => import('../pages/Home').then((module) => ({ default: module.HomePage }))
const materialsLoader = () => import('../pages/student/Materials').then((module) => ({ default: module.Materials }))
const moduleViewLoader = () => import('../pages/student/ModuleView').then((module) => ({ default: module.ModuleView }))
const lessonViewLoader = () => import('../pages/student/LessonView').then((module) => ({ default: module.LessonView }))
const recordingsLoader = () => import('../pages/student/Recordings').then((module) => ({ default: module.Recordings }))
const resourcesLoader = () => import('../pages/student/Resources').then((module) => ({ default: module.Resources }))
const profileLoader = () => import('../pages/student/Profile').then((module) => ({ default: module.Profile }))
const announcementsLoader = () => import('../pages/shared/Announcements').then((module) => ({ default: module.Announcements }))
const messagesLoader = () => import('../pages/shared/Messages').then((module) => ({ default: module.Messages }))
const adminDashboardLoader = () => import('../pages/admin/AdminDashboard').then((module) => ({ default: module.AdminDashboard }))
const studentDetailLoader = () => import('../pages/admin/StudentDetail').then((module) => ({ default: module.StudentDetail }))
const studentPreviewLoader = () => import('../pages/admin/StudentPreview').then((module) => ({ default: module.StudentPreview }))
const studentManagementLoader = () => import('../pages/admin/StudentManagement').then((module) => ({ default: module.StudentManagement }))
const cohortManagementLoader = () => import('../pages/admin/CohortManagement').then((module) => ({ default: module.CohortManagement }))
const cohortDetailLoader = () => import('../pages/admin/CohortDetail').then((module) => ({ default: module.CohortDetail }))
const cohortStudentViewLoader = () => import('../pages/admin/CohortStudentView').then((module) => ({ default: module.CohortStudentView }))
const contentManagementLoader = () => import('../pages/admin/ContentManagement').then((module) => ({ default: module.ContentManagement }))
const lessonEditorLoader = () => import('../pages/admin/LessonEditor').then((module) => ({ default: module.LessonEditor }))
const gradingLoader = () => import('../pages/admin/Grading').then((module) => ({ default: module.Grading }))
const cohortModuleGradingLoader = () => import('../pages/admin/CohortModuleGrading').then((module) => ({ default: module.CohortModuleGrading }))
const cohortWatchProgressLoader = () => import('../pages/admin/CohortWatchProgress').then((module) => ({ default: module.CohortWatchProgress }))
const teamManagementLoader = () => import('../pages/admin/TeamManagement').then((module) => ({ default: module.TeamManagement }))
const signInLoader = () => import('../pages/SignIn').then((module) => ({ default: module.SignInPage }))
const signUpLoader = () => import('../pages/SignIn').then((module) => ({ default: module.SignUpPage }))

export const Dashboard = lazyWithPreload(dashboardLoader)
export const HomePage = lazyWithPreload(homeLoader)
export const Materials = lazyWithPreload(materialsLoader)
export const ModuleView = lazyWithPreload(moduleViewLoader)
export const LessonView = lazyWithPreload(lessonViewLoader)
export const Recordings = lazyWithPreload(recordingsLoader)
export const Resources = lazyWithPreload(resourcesLoader)
export const Profile = lazyWithPreload(profileLoader)
export const Announcements = lazyWithPreload(announcementsLoader)
export const Messages = lazyWithPreload(messagesLoader)
export const AdminDashboard = lazyWithPreload(adminDashboardLoader)
export const StudentDetail = lazyWithPreload(studentDetailLoader)
export const StudentPreview = lazyWithPreload(studentPreviewLoader)
export const StudentManagement = lazyWithPreload(studentManagementLoader)
export const CohortManagement = lazyWithPreload(cohortManagementLoader)
export const CohortDetail = lazyWithPreload(cohortDetailLoader)
export const CohortStudentView = lazyWithPreload(cohortStudentViewLoader)
export const ContentManagement = lazyWithPreload(contentManagementLoader)
export const LessonEditor = lazyWithPreload(lessonEditorLoader)
export const Grading = lazyWithPreload(gradingLoader)
export const CohortModuleGrading = lazyWithPreload(cohortModuleGradingLoader)
export const CohortWatchProgress = lazyWithPreload(cohortWatchProgressLoader)
export const TeamManagement = lazyWithPreload(teamManagementLoader)
export const SignInPage = lazyWithPreload(signInLoader)
export const SignUpPage = lazyWithPreload(signUpLoader)

const routePreloaders: Record<string, Array<() => Promise<unknown>>> = {
  '/': [homeLoader],
  '/dashboard': [dashboardLoader],
  '/materials': [materialsLoader, moduleViewLoader, lessonViewLoader],
  '/recordings': [recordingsLoader],
  '/resources': [resourcesLoader],
  '/profile': [profileLoader],
  '/announcements': [announcementsLoader],
  '/messages': [messagesLoader],
  '/admin': [adminDashboardLoader],
  '/admin/students': [studentManagementLoader, studentDetailLoader, studentPreviewLoader],
  '/admin/cohorts': [cohortManagementLoader, cohortDetailLoader, cohortStudentViewLoader, cohortWatchProgressLoader],
  '/admin/content': [contentManagementLoader, lessonEditorLoader],
  '/admin/grading': [gradingLoader, cohortModuleGradingLoader],
  '/admin/team': [teamManagementLoader],
  '/sign-in': [signInLoader],
  '/sign-up': [signUpLoader],
}

function matchingPreloaders(path: string) {
  const matches = Object.entries(routePreloaders)
    .filter(([route]) => path === route || path.startsWith(`${route}/`))
    .sort((a, b) => b[0].length - a[0].length)

  return matches.flatMap(([, preloaders]) => preloaders)
}

export function preloadRoute(path: string) {
  matchingPreloaders(path).forEach((preload) => {
    void preload()
  })
}

export function preloadPrimaryRoutes(paths: string[]) {
  paths.forEach((path) => preloadRoute(path))
}
