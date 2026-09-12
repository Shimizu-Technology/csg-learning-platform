import AsyncStorage from '@react-native-async-storage/async-storage';

import { contentVideoCleanupKey, queueContentVideoCleanup, retryContentVideoCleanups } from '../content-video-cleanup';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

beforeEach(() => AsyncStorage.clear());

describe('content video cleanup queue', () => {
  it('deduplicates managed keys and removes them after successful cleanup', async () => {
    await Promise.all([
      queueContentVideoCleanup(7, 'content_videos/staged.mp4'),
      queueContentVideoCleanup(7, 'content_videos/staged.mp4'),
    ]);
    const abandon = jest.fn().mockResolvedValue(undefined);

    await retryContentVideoCleanups(7, abandon);

    expect(abandon).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(contentVideoCleanupKey(7))).toBeNull();
  });

  it('retains failed keys for a later retry', async () => {
    await queueContentVideoCleanup(7, 'content_videos/retry.mp4');
    await retryContentVideoCleanups(7, jest.fn().mockRejectedValue(new Error('Offline')));

    expect(JSON.parse((await AsyncStorage.getItem(contentVideoCleanupKey(7)))!)).toEqual(['content_videos/retry.mp4']);
  });

  it('never abandons a video still referenced by a device draft', async () => {
    const s3Key = 'content_videos/still-in-draft.mp4';
    await queueContentVideoCleanup(7, s3Key);
    await AsyncStorage.setItem('csg.lesson-editor-draft.7.101', JSON.stringify({ s3_video_key: s3Key }));
    const abandon = jest.fn().mockResolvedValue(undefined);

    await retryContentVideoCleanups(7, abandon);

    expect(abandon).not.toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem(contentVideoCleanupKey(7)))!)).toEqual([s3Key]);
  });

  it('keeps a queued video through a failed draft clear, then cleans it after a later successful clear', async () => {
    const s3Key = 'content_videos/clear-retry.mp4';
    const draftKey = 'csg.lesson-editor-draft.7.101';
    await AsyncStorage.setItem(draftKey, JSON.stringify({ s3_video_key: s3Key }));
    await queueContentVideoCleanup(7, s3Key);
    const abandon = jest.fn().mockResolvedValue(undefined);

    // A screen remount retries the queue, but the recoverable device draft still owns the upload.
    await retryContentVideoCleanups(7, abandon);
    expect(abandon).not.toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem(contentVideoCleanupKey(7)))!)).toEqual([s3Key]);

    // Once a later discard clears the draft, the same durable queue safely finishes cleanup.
    await AsyncStorage.removeItem(draftKey);
    await retryContentVideoCleanups(7, abandon);
    expect(abandon).toHaveBeenCalledWith(s3Key);
    expect(await AsyncStorage.getItem(contentVideoCleanupKey(7))).toBeNull();
  });
});
