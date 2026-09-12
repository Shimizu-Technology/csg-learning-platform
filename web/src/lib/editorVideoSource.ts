export interface EditorVideoSource {
  s3Key: string | null
  contentType: string | null
  fileSize: number | null
}

interface DeferredVideoUpload {
  contentBlockId?: number
  deferPersistence?: boolean
  s3Key?: string
  contentType: string
  fileSize: number
  status: string
}

export function resolveEditorVideoSource(
  blockId: number,
  fetched: EditorVideoSource,
  uploads: DeferredVideoUpload[],
): EditorVideoSource {
  const live = uploads.find((upload) => (
    upload.contentBlockId === blockId &&
    upload.deferPersistence &&
    upload.s3Key &&
    upload.contentType &&
    upload.fileSize > 0 &&
    upload.status !== 'error'
  ))

  if (!live?.s3Key) return fetched

  return {
    s3Key: live.s3Key,
    contentType: live.contentType,
    fileSize: live.fileSize,
  }
}
