import { describe, expect, it } from 'vitest'
import { getYouTubeId, getVimeoEmbed } from './videoUrls'

describe('YouTube URLs', () => {
  it.each([
    'https://youtu.be/abc_DEF-123?t=30',
    'https://www.youtube.com/embed/abc_DEF-123?start=30',
    'https://www.youtube.com/watch?v=abc_DEF-123&feature=share',
    'https://www.youtube.com/watch?feature=share&v=abc_DEF-123',
    'https://youtube.com/shorts/abc_DEF-123',
    'https://www.youtube.com/live/abc_DEF-123',
    'https://www.youtube-nocookie.com/embed/abc_DEF-123',
  ])('uses the same ID for rendering and tracking: %s', url => {
    expect(getYouTubeId(url)).toBe('abc_DEF-123')
  })
  it.each(['https://youtube.com/shorts/', 'https://example.invalid/video', '', 'https://vimeo.com/123'])('preserves unsupported-format fallback: %s', url => {
    expect(getYouTubeId(url)).toBeNull()
  })
})
describe('Vimeo URLs', () => {
  it('reads the numeric video ID', () => expect(getVimeoEmbed('https://vimeo.com/123456')).toEqual({ id: '123456', hash: undefined }))
  it('preserves the private embed hash', () => expect(getVimeoEmbed('https://vimeo.com/123456/abcDEF123?share=copy')).toEqual({ id: '123456', hash: 'abcDEF123' }))
  it.each(['https://vimeo.com/not-a-video', 'https://example.invalid/video', ''])('rejects unsupported IDs: %s', url => expect(getVimeoEmbed(url)).toBeNull())
})

describe('legacy provider embeds', () => {
  it('recognizes HTTP YouTube only on its provider host', () => {
    expect(getYouTubeId('http://youtu.be/abc_DEF-123')).toBe('abc_DEF-123')
    expect(getYouTubeId('http://youtube.com.example.invalid/watch?v=abc_DEF-123')).toBeNull()
    expect(getYouTubeId('ftp://youtube.com/watch?v=abc_DEF-123')).toBeNull()
  })

  it.each([
    ['http://vimeo.com/123456/98765', '98765'],
    ['https://vimeo.com/123456/98765', '98765'],
    ['https://player.vimeo.com/video/123456?h=aBc123', 'aBc123'],
    ['https://player.vimeo.com/video/123456?h=98765', '98765'],
    ['https://vimeo.com/channels/1234/123456', undefined],
  ])('keeps the route ID separate from its privacy hash: %s', (url, hash) => {
    expect(getVimeoEmbed(url)).toEqual({ id: '123456', hash })
  })
})
