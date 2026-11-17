import { describe, expect, it } from 'vitest'
import { getYouTubeId, getVimeoEmbed } from './videoUrls'

describe('YouTube URLs', () => {
  it.each([
    'https://youtu.be/abc_DEF-123?t=30',
    'https://www.youtube.com/embed/abc_DEF-123?start=30',
    'https://www.youtube.com/watch?v=abc_DEF-123&feature=share',
  ])('uses the same ID for rendering and tracking: %s', url => {
    expect(getYouTubeId(url)).toBe('abc_DEF-123')
  })
  it.each(['https://youtube.com/shorts/abc_DEF-123', 'https://example.invalid/video', '', 'https://vimeo.com/123'])('preserves unsupported-format fallback: %s', url => {
    // Shorts were not supported before extraction; this follow-up keeps Off behavior unchanged.
    expect(getYouTubeId(url)).toBeNull()
  })
})
describe('Vimeo URLs', () => {
  it('reads the numeric video ID', () => expect(getVimeoEmbed('https://vimeo.com/123456')).toEqual({ id: '123456', hash: undefined }))
  it('preserves the private embed hash', () => expect(getVimeoEmbed('https://vimeo.com/123456/abcDEF123?share=copy')).toEqual({ id: '123456', hash: 'abcDEF123' }))
  it.each(['https://vimeo.com/not-a-video', 'https://example.invalid/video', ''])('rejects unsupported IDs: %s', url => expect(getVimeoEmbed(url)).toBeNull())
})
