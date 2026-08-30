import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../contexts/UploadContext', () => ({
  useUpload: () => ({
    startVideoUpload: vi.fn(),
    cancelUpload: vi.fn(),
    uploads: [{
      id: 'queued-video',
      fileName: 'class.mp4',
      fileSize: 1234,
      contentType: 'video/mp4',
      progress: 0,
      status: 'queued',
      contentBlockId: 42,
      abortController: new AbortController(),
    }],
  }),
}))

import { VideoUploadField } from './VideoUploadField'
import { VideoUploadWarning } from './VideoUploadWarning'

describe('video upload UI states', () => {
  it('renders compatibility warnings', () => {
    const markup = renderToStaticMarkup(
      <VideoUploadWarning message="Use H.264 video for reliable playback." />,
    )

    expect(markup).toContain('Use H.264 video for reliable playback.')
    expect(markup).toContain('text-amber-700')
  })

  it('renders the queued state for an exercise video', () => {
    const markup = renderToStaticMarkup(
      <VideoUploadField
        contentBlockId={42}
        videoUrl=""
        onVideoUrlChange={vi.fn()}
        s3VideoKey={null}
        onS3VideoUploaded={vi.fn()}
        onS3VideoRemoved={vi.fn()}
      />,
    )

    expect(markup).toContain('class.mp4')
    expect(markup).toContain('Queued...')
  })
})
