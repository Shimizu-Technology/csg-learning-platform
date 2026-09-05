import { insertVoiceDraft, restoreRawVoiceDraft, voiceDraftSegment, voiceDraftWithinLimit, voiceEditDistanceBucket, type VoiceDraftReview } from '../voice-draft';

describe('voice draft helpers', () => {
  it('inserts at the cursor without replacing typed text', () => {
    const inserted = insertVoiceDraft('BeforeAfter', { start: 6, end: 6 }, 'spoken thought');
    expect(inserted.value).toBe('Before spoken thought After');
    expect(inserted.selection.start).toBe('Before spoken thought '.length);
  });

  it('replaces only the selected range and gives lists breathing room', () => {
    const inserted = insertVoiceDraft('Intro old ending', { start: 6, end: 9 }, '- first\n- second');
    expect(inserted.value).toBe('Intro \n\n- first\n- second\n\n ending');
  });

  it('restores the faithful transcript after edits inside the inserted segment', () => {
    const review: VoiceDraftReview = { rawText: 'raw words', suggestedText: 'Clean words.', prefix: 'Existing ', suffix: ' ending' };
    expect(voiceDraftSegment('Existing Changed clean words ending', review)).toBe('Changed clean words');
    expect(restoreRawVoiceDraft('Existing Changed clean words ending', review)?.value).toBe('Existing raw words ending');
    expect(restoreRawVoiceDraft('Prefix changed', review)).toBeNull();
  });

  it('buckets edits without inspecting or capturing their content', () => {
    const review: VoiceDraftReview = { rawText: 'one two three four', suggestedText: 'One two three four.', prefix: '', suffix: '' };
    expect(voiceEditDistanceBucket(review, 'One two three four.')).toBe('none');
    expect(voiceEditDistanceBucket(review, 'One two three four please.')).toBe('light');
    expect(voiceEditDistanceBucket(review, 'Different message')).toBe('substantial');
  });

  it('applies optional voice-draft limits using Unicode code points', () => {
    expect(voiceDraftWithinLimit('🚀🚀', 2)).toBe(true);
    expect(voiceDraftWithinLimit('🚀🚀a', 2)).toBe(false);
    expect(voiceDraftWithinLimit('', 0)).toBe(true);
    expect(voiceDraftWithinLimit('a', 0)).toBe(false);
    expect(voiceDraftWithinLimit('unbounded')).toBe(true);
  });
});
