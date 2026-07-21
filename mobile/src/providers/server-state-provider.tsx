import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import type { PropsWithChildren } from 'react';
import { useMemo, useState } from 'react';

import { createLearningPersister } from '@/lib/learning-cache';
import { useSession } from '@/providers/session-provider';

const CACHE_BUSTER = 'csg-learning-v1';
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function client() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60_000, gcTime: CACHE_MAX_AGE, retry: 1, networkMode: 'offlineFirst' },
      mutations: { retry: false, networkMode: 'online' },
    },
  });
}

export function ServerStateProvider({ children }: PropsWithChildren) {
  const { user } = useSession();
  if (!user) return <AnonymousServerState>{children}</AnonymousServerState>;
  return <UserServerState key={user.id} userId={user.id}>{children}</UserServerState>;
}

function AnonymousServerState({ children }: PropsWithChildren) {
  const [queryClient] = useState(client);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function UserServerState({ children, userId }: PropsWithChildren<{ userId: number }>) {
  const [queryClient] = useState(client);
  const persister = useMemo(() => createLearningPersister(userId), [userId]);
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, buster: CACHE_BUSTER, maxAge: CACHE_MAX_AGE }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
