import type { SessionEnrollment } from './types';

export function isAlumniOnlyEnrollment(enrollments: SessionEnrollment[]) {
  const activeEnrollments = enrollments.filter((enrollment) => enrollment.status === 'active');
  return activeEnrollments.length > 0 && activeEnrollments.every((enrollment) => enrollment.cohort.cohort_type === 'alumni');
}
