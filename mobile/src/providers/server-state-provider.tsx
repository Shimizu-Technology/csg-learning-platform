import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import type { PropsWithChildren } from 'react';
import { useMemo, useState } from 'react';

import { createLearningPersister } from '@/lib/learning-cache';
import { createServerStateClient, SERVER_CACHE_MAX_AGE, shouldPersistServerQuery } from '@/lib/server-state';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

const CACHE_BUSTER = 'csg-learning-v1';

export function ServerStateProvider({ children }: PropsWithChildren) {
  const { user } = useSession();
  const { demo } = useCsgAuth();
  if (!user) return <AnonymousServerState>{children}</AnonymousServerState>;
  return <UserServerState key={`${user.id}:${demo ? 'demo' : 'live'}`} persist={!demo} userId={user.id}>{children}</UserServerState>;
}

function AnonymousServerState({ children }: PropsWithChildren) {
  const [queryClient] = useState(createServerStateClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function UserServerState({ children, persist, userId }: PropsWithChildren<{ persist: boolean; userId: number }>) {
  const [queryClient] = useState(createServerStateClient);
  const persister = useMemo(() => createLearningPersister(userId), [userId]);
  if (!persist) return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        buster: CACHE_BUSTER,
        maxAge: SERVER_CACHE_MAX_AGE,
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistServerQuery },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
