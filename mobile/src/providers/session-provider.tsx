import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { CsgApi } from '@/lib/api';
import { demoUser } from '@/lib/demo-data';
import { PUSH_TOKEN_KEY, registerPushNotifications } from '@/lib/push-notifications';
import type { SessionUser } from '@/lib/types';
import { useCsgAuth } from './auth-provider';

interface SessionValue {
  api: CsgApi;
  user: SessionUser | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const auth = useCsgAuth();
  const api = useMemo(() => new CsgApi(auth.getToken), [auth.getToken]);
  const userCacheKey = auth.subject ? `csg.session.user.${auth.subject}` : null;
  const [user, setUser] = useState<SessionUser | null>(auth.demo ? demoUser : null);
  const [loading, setLoading] = useState(!auth.demo);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!auth.signedIn) { setUser(null); setLoading(false); return; }
    if (auth.demo) { setUser(demoUser); setLoading(false); return; }
    setLoading(true);
    try {
      const result = await api.session();
      setUser(result.user); setError(null);
      if (userCacheKey) await AsyncStorage.setItem(userCacheKey, JSON.stringify(result.user));
      void registerPushNotifications(api).catch(() => undefined);
    } catch (requestError) {
      const cached = userCacheKey ? await AsyncStorage.getItem(userCacheKey) : null;
      if (cached) {
        try { setUser(JSON.parse(cached) as SessionUser); } catch { await AsyncStorage.removeItem(userCacheKey!); }
      }
      setError((requestError as Error).message);
    } finally { setLoading(false); }
  }, [api, auth.demo, auth.signedIn, userCacheKey]);

  useEffect(() => {
    if (!auth.loaded) return undefined;
    const frame = requestAnimationFrame(() => void refresh());
    return () => cancelAnimationFrame(frame);
  }, [auth.loaded, refresh]);
  const signOut = useCallback(async () => {
    const pushToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (pushToken && !auth.demo) await api.unregisterDevice(pushToken).catch(() => undefined);
    const keys = [PUSH_TOKEN_KEY];
    if (userCacheKey) keys.push(userCacheKey);
    if (user) keys.push(`csg.inbox.${user.id}`, `csg.workspaces.${user.id}`, `csg.workspace.active.${user.id}`);
    await AsyncStorage.multiRemove(keys);
    await auth.signOut();
  }, [api, auth, user, userCacheKey]);
  const value = useMemo(() => ({ api, user, loading, error, refresh, signOut }), [api, user, loading, error, refresh, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within SessionProvider');
  return value;
}
