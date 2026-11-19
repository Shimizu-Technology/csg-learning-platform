// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { rememberedVersion, videoVersions } from './videoVersions'
const versions = [{ id: 'studio', label: 'Studio', s3_video_key: 'studio.mp4' }, { id: 'desktop', label: 'Real desktop', s3_video_key: 'desktop.mp4' }]
afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })
it('remembers stable ids across ordering changes and falls back for removed versions', () => {
  localStorage.setItem('video-version:21', 'desktop')
  expect(rememberedVersion(21, versions)).toBe('desktop')
  expect(rememberedVersion(21, [...versions].reverse())).toBe('desktop')
  expect(rememberedVersion(21, versions.slice(0, 1))).toBe('studio')
  expect(rememberedVersion(22, versions)).toBe('studio')
})
it('works when browser storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  expect(rememberedVersion(21, versions)).toBe('studio')
})
it('ignores malformed metadata', () => {
  expect(videoVersions({ video_versions: [null, {}, versions[0]] })).toEqual([versions[0]])
})
