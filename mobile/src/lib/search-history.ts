const memoryStore = new Map<string, string[]>();

type StorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

function getAsyncStorage(): StorageLike | null {
  try {
    // Lazy require avoids crashing Jest suites that do not mock the native AsyncStorage module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-async-storage/async-storage');
    const storage = (mod?.default ?? mod) as StorageLike | undefined;
    if (storage && typeof storage.getItem === 'function') return storage;
    return null;
  } catch {
    return null;
  }
}

export async function loadRecentSearches(userId: number): Promise<string[]> {
  const key = `csg-mobile-search-recent:${userId}`;
  const storage = getAsyncStorage();
  if (!storage) return memoryStore.get(key) || [];
  try {
    const raw = await storage.getItem(key);
    if (!raw) return memoryStore.get(key) || [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const clean = parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length >= 2).slice(0, 5);
    memoryStore.set(key, clean);
    return clean;
  } catch {
    return memoryStore.get(key) || [];
  }
}

export async function saveRecentSearches(userId: number, terms: string[]): Promise<void> {
  const key = `csg-mobile-search-recent:${userId}`;
  const clean = terms.slice(0, 5);
  memoryStore.set(key, clean);
  const storage = getAsyncStorage();
  if (!storage) return;
  try {
    await storage.setItem(key, JSON.stringify(clean));
  } catch {
    // Persistence is optional.
  }
}

export async function clearRecentSearches(userId: number): Promise<void> {
  const key = `csg-mobile-search-recent:${userId}`;
  memoryStore.delete(key);
  const storage = getAsyncStorage();
  if (!storage) return;
  try {
    await storage.removeItem(key);
  } catch {
    // Persistence is optional.
  }
}
