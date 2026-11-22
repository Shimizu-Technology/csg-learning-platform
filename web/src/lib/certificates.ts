import type { components } from '../types/api.generated'

export type CertificateVerification = components['schemas']['CertificateVerification']
export type CourseCompletion = components['schemas']['CourseCompletionResponse']
export type StaffCourseCertificate = components['schemas']['StaffCourseCertificate']
export type CourseCompletionNextStep = components['schemas']['CourseCompletionNextStep']

export const CERTIFICATE_TITLE = 'Certificate of Completion'

export function certificatePath(code: string) {
  return `/certificates/${encodeURIComponent(code)}`
}
