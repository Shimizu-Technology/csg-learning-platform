export interface UploadProgress {
  percent: number
  loaded: number
  total: number
}

export interface MultipartUploadPart {
  part_number: number
  etag: string
}

export interface MultipartUploadHandlers {
  initiate: () => Promise<{ s3Key: string; uploadId: string }>
  getPartUrl: (partNumber: number) => Promise<string>
  complete: (parts: MultipartUploadPart[]) => Promise<void>
  abort: () => Promise<void>
}

export const MULTIPART_UPLOAD_THRESHOLD = 100 * 1024 * 1024
const MULTIPART_PART_SIZE = 16 * 1024 * 1024
const MULTIPART_CONCURRENCY = 3
const MULTIPART_MAX_ATTEMPTS = 4

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

    xhr.addEventListener('error', () => {
      console.error(
        'S3 direct upload failed before the file was accepted. Possible causes include a network issue, missing S3 bucket CORS origin, or bucket-region mismatch.'
      )
      reject(new Error('Upload failed — the file could not be sent to storage. Check your connection and try again.'))
    })
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => xhr.abort())
    }

    xhr.open('POST', url)
    xhr.send(formData)
  })
}

export async function uploadMultipartToS3(
  file: File,
  handlers: MultipartUploadHandlers,
  onProgress?: (progress: UploadProgress) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  await handlers.initiate()
  const internalAbortController = new AbortController()
  const handleExternalAbort = () => internalAbortController.abort()
  if (abortSignal?.aborted) {
    internalAbortController.abort()
  } else {
    abortSignal?.addEventListener('abort', handleExternalAbort, { once: true })
  }
  const parts = buildParts(file)
  const loadedByPart = new Map<number, number>()
  const completedParts: MultipartUploadPart[] = []

  const reportProgress = () => {
    const loaded = Array.from(loadedByPart.values()).reduce((sum, value) => sum + value, 0)
    onProgress?.({
      loaded,
      total: file.size,
      percent: Math.min(99, Math.round((loaded / file.size) * 100)),
    })
  }

  let cursor = 0

  try {
    await Promise.all(Array.from({ length: Math.min(MULTIPART_CONCURRENCY, parts.length) }, async () => {
      while (cursor < parts.length) {
        const part = parts[cursor]
        cursor += 1

        const etag = await uploadPartWithRetry(
          file.slice(part.start, part.end),
          part.number,
          () => handlers.getPartUrl(part.number),
          (loaded) => {
            loadedByPart.set(part.number, loaded)
            reportProgress()
          },
          internalAbortController.signal
        )

        loadedByPart.set(part.number, part.end - part.start)
        completedParts.push({ part_number: part.number, etag })
        reportProgress()
      }
    }))

    await handlers.complete(completedParts)
    onProgress?.({ loaded: file.size, total: file.size, percent: 100 })
  } catch (error) {
    internalAbortController.abort()
    await handlers.abort().catch(() => {})
    throw error
  } finally {
    abortSignal?.removeEventListener('abort', handleExternalAbort)
  }
}

function buildParts(file: File) {
  const parts: Array<{ number: number; start: number; end: number }> = []
  for (let start = 0, number = 1; start < file.size; start += MULTIPART_PART_SIZE, number += 1) {
    parts.push({ number, start, end: Math.min(start + MULTIPART_PART_SIZE, file.size) })
  }
  return parts
}

async function uploadPartWithRetry(
  blob: Blob,
  partNumber: number,
  getPartUrl: () => Promise<string>,
  onProgress: (loaded: number) => void,
  abortSignal?: AbortSignal
): Promise<string> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MULTIPART_MAX_ATTEMPTS; attempt += 1) {
    try {
      const url = await getPartUrl()
      return await uploadPart(url, blob, onProgress, abortSignal)
    } catch (error) {
      if (abortSignal?.aborted) throw error
      lastError = error
      if (attempt < MULTIPART_MAX_ATTEMPTS) {
        await wait(750 * attempt * attempt, abortSignal)
      }
    }
  }

  throw lastError instanceof Error
    ? new Error(`Part ${partNumber} failed after ${MULTIPART_MAX_ATTEMPTS} attempts: ${lastError.message}`)
    : new Error(`Part ${partNumber} failed after ${MULTIPART_MAX_ATTEMPTS} attempts`)
}

function uploadPart(
  url: string,
  blob: Blob,
  onProgress: (loaded: number) => void,
  abortSignal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(e.loaded)
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag')
        if (etag) resolve(etag)
        else reject(new Error('Upload part completed but S3 did not expose an ETag header. Check the bucket CORS exposed headers.'))
      } else {
        reject(new Error(`Upload part failed with status ${xhr.status}`))
      }
    })

    xhr.addEventListener('error', () => reject(new Error('Network interrupted while uploading a video chunk. Retrying...')))
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => xhr.abort(), { once: true })
    }

    xhr.open('PUT', url)
    xhr.send(blob)
  })
}

function wait(ms: number, abortSignal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(new Error('Upload cancelled'))
      return
    }

    const timeout = window.setTimeout(resolve, ms)
    abortSignal?.addEventListener('abort', () => {
      window.clearTimeout(timeout)
      reject(new Error('Upload cancelled'))
    }, { once: true })
  })
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
