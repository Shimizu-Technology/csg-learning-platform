import { describe, expect, it } from 'vitest'
import { prepareUploadAttachment } from '../UploadContext'

describe('prepareUploadAttachment', () => {
  it('enables persistence when a waiting deferred upload gets its content block', () => {
    const abortController = new AbortController()
    const currentUpload = {
      id: 'upload-1',
      fileName: 'exercise.mp4',
      fileSize: 1234,
      contentType: 'video/mp4',
      progress: 100,
      status: 'waiting' as const,
      s3Key: 'content_videos/upload-1/exercise.mp4',
      deferPersistence: true,
      abortController,
    }

    const attachment = prepareUploadAttachment(
      { deferPersistence: true },
      currentUpload,
      { contentBlockId: 42, persistedS3Key: null },
    )

    expect(attachment.persistedS3Key).toBeNull()
    expect(attachment.target).toMatchObject({ contentBlockId: 42, deferPersistence: false })
    expect(attachment.nextUpload).toMatchObject({
      contentBlockId: 42,
      deferPersistence: false,
      status: 'waiting',
      s3Key: 'content_videos/upload-1/exercise.mp4',
    })
  })
})
