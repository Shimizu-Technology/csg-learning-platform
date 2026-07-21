import { createRetryableInitializer, learningCacheKey } from '../learning-cache';

describe('learning cache', () => {
  it('scopes persisted learning data by version and Rails user', () => {
    expect(learningCacheKey(42)).toBe('learning-v1:user:42');
    expect(learningCacheKey(42)).not.toBe(learningCacheKey(43));
  });

  it('retries database initialization after a transient open failure', async () => {
    const database = { ready: true };
    const open = jest.fn()
      .mockRejectedValueOnce(new Error('disk temporarily unavailable'))
      .mockResolvedValue(database);
    const initialize = createRetryableInitializer(open);

    await expect(initialize()).rejects.toThrow('disk temporarily unavailable');
    await expect(initialize()).resolves.toBe(database);
    await expect(initialize()).resolves.toBe(database);
    expect(open).toHaveBeenCalledTimes(2);
  });
});
