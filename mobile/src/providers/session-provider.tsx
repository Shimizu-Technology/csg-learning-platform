import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { CsgApi } from '@/lib/api';
import { demoUser } from '@/lib/demo-data';
import { PUSH_TOKEN_KEY, registerPushNotifications } from '@/lib/push-notifications';
import { canUseCachedSession, isSessionAccessDenied } from '@/lib/session-access';
import type { SessionUser } from '@/lib/types';
import { useCsgAuth } from './auth-provider';

interface SessionValue {
  api: CsgApi;
  user: SessionUser | null;
  loading: boolean;
  error: string | null;
  accessDenied: boolean;
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
  const [accessDenied, setAccessDenied] = useState(false);

  const refresh = useCallback(async () => {
    if (!auth.signedIn) { setUser(null); setError(null); setAccessDenied(false); setLoading(false); return; }
    if (auth.demo) { setUser(demoUser); setError(null); setAccessDenied(false); setLoading(false); return; }
    setLoading(true);
    setAccessDenied(false);
    try {
      const result = await api.session();
      setUser(result.user); setError(null); setAccessDenied(false);
      if (userCacheKey) await AsyncStorage.setItem(userCacheKey, JSON.stringify(result.user));
      void registerPushNotifications(api).catch(() => undefined);
    } catch (requestError) {
      const cached = userCacheKey ? await AsyncStorage.getItem(userCacheKey) : null;
      if (isSessionAccessDenied(requestError)) {
        let cachedUserId: number | null = null;
        if (cached) {
          try { cachedUserId = (JSON.parse(cached) as SessionUser).id; } catch { cachedUserId = null; }
        }
        const keys = [PUSH_TOKEN_KEY];
        if (userCacheKey) keys.push(userCacheKey);
        if (cachedUserId) keys.push(`csg.inbox.${cachedUserId}`, `csg.workspaces.${cachedUserId}`, `csg.workspace.active.${cachedUserId}`);
        if (keys.length) await AsyncStorage.multiRemove(keys);
        setUser(null);
        setAccessDenied(true);
      } else if (cached && canUseCachedSession(requestError)) {
        try { setUser(JSON.parse(cached) as SessionUser); } catch { await AsyncStorage.removeItem(userCacheKey!); setUser(null); }
      } else {
        setUser(null);
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
  const value = useMemo(() => ({ api, user, loading, error, accessDenied, refresh, signOut }), [api, user, loading, error, accessDenied, refresh, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within SessionProvider');
  return value;
}
