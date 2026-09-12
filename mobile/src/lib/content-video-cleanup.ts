import AsyncStorage from '@react-native-async-storage/async-storage';

const cleanupWrites = new Map<string, Promise<void>>();

export function contentVideoCleanupKey(userId: number) {
  return `csg.content-video-cleanup.${userId}`;
}

function validKeys(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return Array.from(new Set(parsed.filter((key): key is string => typeof key === 'string' && key.startsWith('content_videos/'))));
  } catch {
    return [];
  }
}

function enqueue(userId: number, operation: (storageKey: string) => Promise<void>) {
  const storageKey = contentVideoCleanupKey(userId);
  const previous = cleanupWrites.get(storageKey) || Promise.resolve();
  const write = previous.catch(() => undefined).then(() => operation(storageKey));
  cleanupWrites.set(storageKey, write);
  return write.finally(() => {
    if (cleanupWrites.get(storageKey) === write) cleanupWrites.delete(storageKey);
  });
}

async function locallyReferencedVideoKeys(userId: number) {
  const draftPrefix = `csg.lesson-editor-draft.${userId}.`;
  const draftKeys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(draftPrefix));
  const referenced = new Set<string>();
  if (!draftKeys.length) return referenced;
  for (const [, value] of await AsyncStorage.multiGet(draftKeys)) {
    try {
      const s3Key = value ? JSON.parse(value)?.s3_video_key : null;
      if (typeof s3Key === 'string' && s3Key.startsWith('content_videos/')) referenced.add(s3Key);
    } catch { /* Malformed drafts are handled by the draft loader. */ }
  }
  return referenced;
}

export function queueContentVideoCleanup(userId: number, s3Key: string) {
  if (!s3Key.startsWith('content_videos/')) return Promise.reject(new Error('Only managed lesson videos can be queued for cleanup.'));
  return enqueue(userId, async (storageKey) => {
    const keys = validKeys(await AsyncStorage.getItem(storageKey));
    if (!keys.includes(s3Key)) keys.push(s3Key);
    await AsyncStorage.setItem(storageKey, JSON.stringify(keys));
  });
}

export function retryContentVideoCleanups(userId: number, abandon: (s3Key: string) => Promise<void>) {
  return enqueue(userId, async (storageKey) => {
    const keys = validKeys(await AsyncStorage.getItem(storageKey));
    const referenced = await locallyReferencedVideoKeys(userId);
    const remaining: string[] = [];
    for (const key of keys) {
      if (referenced.has(key)) { remaining.push(key); continue; }
      try { await abandon(key); }
      catch { remaining.push(key); }
    }
    if (remaining.length) await AsyncStorage.setItem(storageKey, JSON.stringify(remaining));
    else await AsyncStorage.removeItem(storageKey);
  });
}
