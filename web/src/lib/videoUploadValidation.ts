const VIDEO_CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
}

const VIDEO_FILE_ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm'

function extensionFor(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() || ''
}

export function isSupportedVideoFile(file: File) {
  const extension = extensionFor(file.name)
  return file.type.startsWith('video/') || Object.prototype.hasOwnProperty.call(VIDEO_CONTENT_TYPES_BY_EXTENSION, extension)
}

export function resolvedVideoContentType(file: File) {
  if (file.type.startsWith('video/')) return file.type

  const extension = extensionFor(file.name)
  return Object.prototype.hasOwnProperty.call(VIDEO_CONTENT_TYPES_BY_EXTENSION, extension)
    ? VIDEO_CONTENT_TYPES_BY_EXTENSION[extension]
    : 'video/mp4'
}

export function videoCompatibilityWarning(file: File) {
  const extension = extensionFor(file.name)
  const contentType = resolvedVideoContentType(file)
  if (extension === 'mp4' && contentType === 'video/mp4') return null

  return 'For the most reliable playback across student devices, use an MP4 encoded with H.264 video and AAC audio.'
}

export { VIDEO_FILE_ACCEPT }
