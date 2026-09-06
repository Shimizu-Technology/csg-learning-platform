import { QueryClient, type Query } from '@tanstack/react-query';

export const SERVER_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export function createServerStateClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, gcTime: SERVER_CACHE_MAX_AGE, retry: 1, networkMode: 'offlineFirst' },
      mutations: { retry: false, networkMode: 'online' },
    },
  });
  queryClient.setQueryDefaults(['messaging'], { meta: { persist: false } });
  return queryClient;
}

export function shouldPersistServerQuery(query: Query) {
  return query.meta?.persist !== false;
}
