import { describe, expect, it, vi } from 'vitest'
import { createCohortRecordingForUpload, prepareUploadAttachment } from '../UploadContext'

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

describe('createCohortRecordingForUpload', () => {
  it('sends the explicit publish-immediately choice to the recording API', async () => {
    const createRecording = vi.fn().mockResolvedValue({ data: { recording: { id: 1 } } })

    await createCohortRecordingForUpload(
      { createRecording } as never,
      { cohortId: 7, title: 'Public class', publishImmediately: true },
      'recordings/public.mp4',
      'video/mp4',
      1234,
    )

    expect(createRecording).toHaveBeenCalledWith(7, expect.objectContaining({
      title: 'Public class',
      publish_immediately: true,
    }))
  })

  it('keeps the default recording path private', async () => {
    const createRecording = vi.fn().mockResolvedValue({ data: { recording: { id: 2 } } })

    await createCohortRecordingForUpload(
      { createRecording } as never,
      { cohortId: 7, title: 'Draft class' },
      'recordings/draft.mp4',
      'video/mp4',
      1234,
    )

    expect(createRecording).toHaveBeenCalledWith(7, expect.objectContaining({
      title: 'Draft class',
      publish_immediately: undefined,
    }))
  })
})
