import { describe, expect, it } from 'vitest'
import {
  isSupportedVideoFile,
  resolvedVideoContentType,
  videoCompatibilityWarning,
} from './videoUploadValidation'

describe('video upload validation', () => {
  it('accepts known video extensions when the browser omits a MIME type', () => {
    const file = new File(['video'], 'class-recording.MOV')

    expect(isSupportedVideoFile(file)).toBe(true)
    expect(resolvedVideoContentType(file)).toBe('video/quicktime')
  })

  it('replaces a generic browser MIME type with the known video type', () => {
    const file = new File(['video'], 'class-recording.mp4', { type: 'application/octet-stream' })

    expect(isSupportedVideoFile(file)).toBe(true)
    expect(resolvedVideoContentType(file)).toBe('video/mp4')
  })

  it('rejects unknown non-video files', () => {
    expect(isSupportedVideoFile(new File(['notes'], 'notes.txt', { type: 'text/plain' }))).toBe(false)
  })

  it('rejects inherited object property names as extensions', () => {
    expect(isSupportedVideoFile(new File(['video'], 'class.constructor'))).toBe(false)
    expect(isSupportedVideoFile(new File(['video'], 'class.__proto__'))).toBe(false)
  })

  it('warns for formats with less consistent browser playback', () => {
    const mov = new File(['video'], 'class.mov', { type: 'video/quicktime' })
    const mp4 = new File(['video'], 'class.mp4', { type: 'video/mp4' })

    expect(videoCompatibilityWarning(mov)).toContain('MP4')
    expect(videoCompatibilityWarning(mp4)).toBeNull()
  })
})
