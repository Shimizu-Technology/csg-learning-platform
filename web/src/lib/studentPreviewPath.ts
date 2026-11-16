import { cohortStudentViewPath } from './routes'

/** Map learner destinations before rendering anchors, including new-tab clicks. */
export function studentPreviewPath(path: string, cohortId: number, studentId?: number | null) {
  if (!path.startsWith('/') || path.startsWith('//')) return path
  const url = new URL(path, 'https://csg.local')
  const base = cohortStudentViewPath(cohortId)
  if (url.pathname.startsWith('/admin/')) return path
  const record = url.pathname.match(/^\/(lessons|modules)\/([1-9]\d*)\/?$/)
  const section = record ? `/${record[1]}/${record[2]}`
    : url.pathname === '/dashboard' || url.pathname === '/' ? ''
    : url.pathname.startsWith('/recordings') ? '/recordings'
    : url.pathname.startsWith('/resources') ? '/resources'
    : url.pathname.startsWith('/announcements') ? '/announcements'
    : url.pathname.startsWith('/messages') ? '/messages'
    : url.pathname.startsWith('/profile') ? '/profile'
    : '/materials'
  return `${base}${section}${studentId ? `?student_id=${studentId}` : ''}${url.hash}`
}
