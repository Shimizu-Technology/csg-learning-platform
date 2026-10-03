import { api } from './api'
import { sanitizeUrl } from './sanitizeUrl'

export async function downloadCourseResource(curriculumId: number, resourceId: number, filename: string) {
  const result = await api.downloadCurriculumResource(curriculumId, resourceId)
  if (!result.data) throw new Error(result.error || 'Could not download this file.')
  const url = sanitizeUrl(result.data.url)
  if (!url.startsWith('https://')) throw new Error('File storage returned an invalid download link.')
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noreferrer'
  link.click()
}
