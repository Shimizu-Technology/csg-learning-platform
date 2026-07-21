import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import * as SQLite from 'expo-sqlite';

const CACHE_DATABASE = 'csg-connect.db';
const CACHE_TABLE = 'learning_query_cache';
const CACHE_VERSION = 1;

export function learningCacheKey(userId: number) {
  return `learning-v${CACHE_VERSION}:user:${userId}`;
}

export function createRetryableInitializer<T>(initialize: () => Promise<T>) {
  let promise: Promise<T> | null = null;
  return () => {
    if (!promise) {
      promise = initialize().catch((error) => {
        promise = null;
        throw error;
      });
    }
    return promise;
  };
}

const database = createRetryableInitializer(async () => {
  const db = await SQLite.openDatabaseAsync(CACHE_DATABASE);
  await db.execAsync(`CREATE TABLE IF NOT EXISTS ${CACHE_TABLE} (cache_key TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)`);
  return db;
});

export function createLearningPersister(userId: number): Persister {
  const cacheKey = learningCacheKey(userId);
  return {
    persistClient: async (client) => {
      const db = await database();
      await db.runAsync(
        `INSERT OR REPLACE INTO ${CACHE_TABLE} (cache_key, payload, updated_at) VALUES (?, ?, ?)`,
        cacheKey,
        JSON.stringify(client),
        Date.now(),
      );
    },
    restoreClient: async () => {
      const db = await database();
      const row = await db.getFirstAsync<{ payload: string }>(`SELECT payload FROM ${CACHE_TABLE} WHERE cache_key = ?`, cacheKey);
      if (!row) return undefined;
      try {
        return JSON.parse(row.payload) as PersistedClient;
      } catch {
        await db.runAsync(`DELETE FROM ${CACHE_TABLE} WHERE cache_key = ?`, cacheKey);
        return undefined;
      }
    },
    removeClient: async () => {
      const db = await database();
      await db.runAsync(`DELETE FROM ${CACHE_TABLE} WHERE cache_key = ?`, cacheKey);
    },
  };
}

export async function clearLearningCache(userId: number) {
  const db = await database();
  await db.runAsync(`DELETE FROM ${CACHE_TABLE} WHERE cache_key = ?`, learningCacheKey(userId));
}
