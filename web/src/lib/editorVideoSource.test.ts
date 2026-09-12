import { describe, expect, it } from 'vitest'

import { resolveEditorVideoSource } from './editorVideoSource'

describe('resolveEditorVideoSource', () => {
  it('restores a deferred upload and its metadata together after returning to the editor', () => {
    const result = resolveEditorVideoSource(
      42,
      { s3Key: null, contentType: null, fileSize: null },
      [{
        contentBlockId: 42,
        deferPersistence: true,
        s3Key: 'content_videos/42/lesson.mp4',
        contentType: 'video/mp4',
        fileSize: 12_345,
        status: 'waiting',
      }],
    )

    expect(result).toEqual({
      s3Key: 'content_videos/42/lesson.mp4',
      contentType: 'video/mp4',
      fileSize: 12_345,
    })
  })

  it('does not recover a live key without the metadata required to save it', () => {
    const fetched = { s3Key: null, contentType: null, fileSize: null }

    expect(resolveEditorVideoSource(42, fetched, [{
      contentBlockId: 42,
      deferPersistence: true,
      s3Key: 'content_videos/42/incomplete.mp4',
      contentType: '',
      fileSize: 0,
      status: 'waiting',
    }])).toEqual(fetched)
  })

  it('keeps the persisted source when there is no matching deferred upload', () => {
    const fetched = { s3Key: 'content_videos/42/saved.mov', contentType: 'video/quicktime', fileSize: 987 }

    expect(resolveEditorVideoSource(42, fetched, [])).toEqual(fetched)
  })
})
