import { describe, expect, it } from 'vitest'
import {
  formatVoiceDuration,
  insertVoiceDraft,
  pickSupportedAudioMimeType,
  restoreRawVoiceDraft,
  voiceDraftWithinLimit,
  voiceEditDistanceBucket,
  voiceRecordingFilename,
} from './voiceDraft'

describe('voiceDraft helpers', () => {
  it('inserts text into empty and non-empty drafts with appropriate spacing', () => {
    const empty = insertVoiceDraft('', { start: 0, end: 0 }, 'Great job on loops.')
    expect(empty.value).toBe('Great job on loops.')
    expect(empty.selection).toEqual({ start: 19, end: 19 })

    const appended = insertVoiceDraft('Nice work.', { start: 10, end: 10 }, 'Check edge cases.')
    expect(appended.value).toBe('Nice work. Check edge cases.')
    expect(appended.prefix).toBe('Nice work. ')
    expect(appended.suffix).toBe('')

    const middle = insertVoiceDraft('Start end', { start: 5, end: 6 }, 'middle')
    expect(middle.value).toBe('Start middle end')
    expect(middle.prefix).toBe('Start ')
    expect(middle.suffix).toBe(' end')

    const multiline = insertVoiceDraft('Notes:', { start: 6, end: 6 }, '- Item 1\n- Item 2')
    expect(multiline.value).toBe('Notes:\n\n- Item 1\n- Item 2')
  })

  it('restores the raw transcript when surrounding text is unchanged, and refuses when context changed', () => {
    const inserted = insertVoiceDraft('Hi,', { start: 3, end: 3 }, 'Check your loop counter.')
    const review = {
      rawText: 'um check your loop counter',
      suggestedText: 'Check your loop counter.',
      prefix: inserted.prefix,
      suffix: inserted.suffix,
    }

    const edited = 'Hi, Check your loop index.'
    const restored = restoreRawVoiceDraft(edited, review)
    expect(restored).toEqual({
      value: 'Hi, um check your loop counter',
      selection: { start: 30, end: 30 },
    })

    expect(restoreRawVoiceDraft('Hello, Check your loop counter.', review)).toBeNull()
  })

  it('checks draft character limits by Unicode code points', () => {
    expect(voiceDraftWithinLimit('abc', 3)).toBe(true)
    expect(voiceDraftWithinLimit('abcd', 3)).toBe(false)
    expect(voiceDraftWithinLimit('abc', undefined)).toBe(true)
    expect(voiceDraftWithinLimit('a\u{1F600}b', 3)).toBe(true)
  })

  it('categorizes edit distance into none, light, and substantial', () => {
    const review = {
      rawText: 'check the loop condition in ruby',
      suggestedText: 'Check the loop condition in Ruby.',
      prefix: '',
      suffix: '',
    }

    expect(voiceEditDistanceBucket(review, 'Check the loop condition in Ruby.')).toBe('none')
    expect(voiceEditDistanceBucket(review, 'Check the loop condition in Rails.')).toBe('light')
    expect(voiceEditDistanceBucket(review, 'Completely rewritten note')).toBe('substantial')
  })

  it('picks supported browser audio MIME types in preference order', () => {
    expect(pickSupportedAudioMimeType((type) => type === 'audio/mp4' || type === 'audio/webm;codecs=opus')).toBe('audio/mp4')
    expect(pickSupportedAudioMimeType((type) => type === 'audio/webm;codecs=opus' || type === 'audio/webm')).toBe('audio/webm;codecs=opus')
    expect(pickSupportedAudioMimeType((type) => type === 'audio/webm')).toBe('audio/webm')
    expect(pickSupportedAudioMimeType((type) => type === 'audio/ogg;codecs=opus')).toBe('audio/ogg;codecs=opus')
    expect(pickSupportedAudioMimeType(() => false)).toBe('')
  })

  it('maps MIME types to expected filenames and formats durations', () => {
    expect(voiceRecordingFilename('audio/mp4;codecs=mp4a.40.2')).toBe('voice-draft.m4a')
    expect(voiceRecordingFilename('audio/webm;codecs=opus')).toBe('voice-draft.webm')
    expect(voiceRecordingFilename('audio/ogg;codecs=opus')).toBe('voice-draft.ogg')
    expect(voiceRecordingFilename('')).toBe('voice-draft.webm')

    expect(formatVoiceDuration(0)).toBe('0:00')
    expect(formatVoiceDuration(9)).toBe('0:09')
    expect(formatVoiceDuration(65)).toBe('1:05')
    expect(formatVoiceDuration(300)).toBe('5:00')
  })
})
