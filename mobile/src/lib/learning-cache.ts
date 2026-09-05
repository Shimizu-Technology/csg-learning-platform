import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import * as SQLite from 'expo-sqlite';
import { beginUserStorageCleanup, userStorageCleanupIsCurrent, userStorageGeneration, userStorageGenerationIsCurrent, type UserStorageCleanup } from './user-storage-lifecycle';

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

type LearningDatabase = Pick<SQLite.SQLiteDatabase, 'getFirstAsync' | 'runAsync'>;

export function createLearningPersister(userId: number, loadDatabase: () => Promise<LearningDatabase> = database): Persister {
  const cacheKey = learningCacheKey(userId);
  return {
    persistClient: async (client) => {
      const generation = userStorageGeneration(userId);
      if (!userStorageGenerationIsCurrent(userId, generation)) return;
      const db = await loadDatabase();
      if (!userStorageGenerationIsCurrent(userId, generation)) return;
      await db.runAsync(
        `INSERT OR REPLACE INTO ${CACHE_TABLE} (cache_key, payload, updated_at) VALUES (?, ?, ?)`,
        cacheKey,
        JSON.stringify(client),
        Date.now(),
      );
    },
    restoreClient: async () => {
      const generation = userStorageGeneration(userId);
      if (!userStorageGenerationIsCurrent(userId, generation)) return undefined;
      const db = await loadDatabase();
      if (!userStorageGenerationIsCurrent(userId, generation)) return undefined;
      const row = await db.getFirstAsync<{ payload: string }>(`SELECT payload FROM ${CACHE_TABLE} WHERE cache_key = ?`, cacheKey);
      if (!userStorageGenerationIsCurrent(userId, generation)) return undefined;
      if (!row) return undefined;
      try {
        return JSON.parse(row.payload) as PersistedClient;
      } catch {
        if (userStorageGenerationIsCurrent(userId, generation)) {
          await db.runAsync(`DELETE FROM ${CACHE_TABLE} WHERE cache_key = ?`, cacheKey);
        }
        return undefined;
      }
    },
    removeClient: async () => {
      const generation = userStorageGeneration(userId);
      if (!userStorageGenerationIsCurrent(userId, generation)) return;
      const db = await loadDatabase();
      if (!userStorageGenerationIsCurrent(userId, generation)) return;
      await db.runAsync(`DELETE FROM ${CACHE_TABLE} WHERE cache_key = ?`, cacheKey);
    },
  };
}

export async function clearLearningCache(userId: number, cleanup: UserStorageCleanup = beginUserStorageCleanup(userId)) {
  const db = await database();
  if (!userStorageCleanupIsCurrent(cleanup)) return;
  await db.runAsync(`DELETE FROM ${CACHE_TABLE} WHERE cache_key = ?`, learningCacheKey(userId));
}
