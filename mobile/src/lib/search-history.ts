const memoryStore = new Map<string, string[]>();
const authoritativeKeys = new Set<string>();
const clearVersions = new Map<string, number>();

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
  if (authoritativeKeys.has(key)) return memoryStore.get(key) || [];
  const versionAtStart = clearVersions.get(key) ?? 0;
  const storage = getAsyncStorage();
  if (!storage) return memoryStore.get(key) || [];
  try {
    const raw = await storage.getItem(key);
    if (authoritativeKeys.has(key) || (clearVersions.get(key) ?? 0) !== versionAtStart) {
      return memoryStore.get(key) || [];
    }
    if (!raw) return memoryStore.get(key) || [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const clean = parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length >= 2).slice(0, 5);
    memoryStore.set(key, clean);
    authoritativeKeys.add(key);
    return clean;
  } catch {
    return memoryStore.get(key) || [];
  }
}

export async function saveRecentSearches(userId: number, terms: string[]): Promise<void> {
  const key = `csg-mobile-search-recent:${userId}`;
  const clean = terms.slice(0, 5);
  memoryStore.set(key, clean);
  authoritativeKeys.add(key);
  const storage = getAsyncStorage();
  if (!storage) return;
  try {
    await storage.setItem(key, JSON.stringify(clean));
  } catch {
    // Persistence is optional; authoritative memory copy remains current.
  }
}

export async function addRecentSearch(userId: number, term: string): Promise<string[] | null> {
  const key = `csg-mobile-search-recent:${userId}`;
  const versionAtStart = clearVersions.get(key) ?? 0;
  const clean = term.trim();
  const current = await loadRecentSearches(userId);
  if ((clearVersions.get(key) ?? 0) !== versionAtStart) return null;
  if (clean.length < 2) return current;
  const next = [clean, ...current.filter((entry) => entry.toLowerCase() !== clean.toLowerCase())].slice(0, 5);
  if ((clearVersions.get(key) ?? 0) !== versionAtStart) return null;
  await saveRecentSearches(userId, next);
  return (clearVersions.get(key) ?? 0) === versionAtStart ? next : null;
}

export async function clearRecentSearches(userId: number): Promise<void> {
  const key = `csg-mobile-search-recent:${userId}`;
  clearVersions.set(key, (clearVersions.get(key) ?? 0) + 1);
  memoryStore.set(key, []);
  authoritativeKeys.add(key);
  const storage = getAsyncStorage();
  if (!storage) return;
  try {
    await storage.removeItem(key);
  } catch {
    // Persistence is optional; authoritative memory copy stays cleared.
  }
}
