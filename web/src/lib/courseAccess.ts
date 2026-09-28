export function hasCourseAccess(enrollment: { status: string; access_expires_at?: string | null }): boolean {
  return enrollment.status === 'active' &&
    (!enrollment.access_expires_at || new Date(enrollment.access_expires_at).getTime() > Date.now())
}
