import { learningCacheKey } from '../learning-cache';

describe('learning cache', () => {
  it('scopes persisted learning data by version and Rails user', () => {
    expect(learningCacheKey(42)).toBe('learning-v1:user:42');
    expect(learningCacheKey(42)).not.toBe(learningCacheKey(43));
  });
});
