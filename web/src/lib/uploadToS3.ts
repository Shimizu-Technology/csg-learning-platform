export interface UploadProgress {
  percent: number
  loaded: number
  total: number
}

export function uploadToS3(
  url: string,
  fields: Record<string, string>,
  file: File,
  onProgress?: (progress: UploadProgress) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    Object.entries(fields).forEach(([key, value]) => formData.append(key, value))
    formData.append('file', file)

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({
          percent: Math.round((e.loaded / e.total) * 100),
          loaded: e.loaded,
          total: e.total,
        })
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else {
        let detail = ''
        try {
          const parser = new DOMParser()
          const xml = parser.parseFromString(xhr.responseText, 'text/xml')
          const code = xml.querySelector('Code')?.textContent
          const message = xml.querySelector('Message')?.textContent
          if (code || message) detail = ` (${code}: ${message})`
        } catch { /* ignore parse errors */ }
        reject(new Error(`Upload failed with status ${xhr.status}${detail}`))
      }
    })

    xhr.addEventListener('error', () => reject(new Error('Upload failed — check your connection')))
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => xhr.abort())
    }

    xhr.open('POST', url)
    xhr.send(formData)
  })
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
