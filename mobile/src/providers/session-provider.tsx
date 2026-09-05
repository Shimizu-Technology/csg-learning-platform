import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { CsgApi } from '@/lib/api';
import { demoUser } from '@/lib/demo-data';
import { PUSH_TOKEN_KEY, registerPushNotifications } from '@/lib/push-notifications';
import { clearLearningCache } from '@/lib/learning-cache';
import { activateUserConversationStorage, clearUserConversationStorage } from '@/lib/conversation-storage';
import { canUseCachedSession, isSessionAccessDenied, parseCachedSessionUser } from '@/lib/session-access';
import { clearUserSubmissionDrafts } from '@/lib/submission-storage';
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
  const userIdRef = useRef<number | null>(user?.id ?? null);
  const lastUserIdRef = useRef<number | null>(user?.id ?? null);
  const refreshGenerationRef = useRef(0);
  const authSubjectRef = useRef(auth.subject);
  useLayoutEffect(() => {
    if (authSubjectRef.current === auth.subject) return;
    authSubjectRef.current = auth.subject;
    userIdRef.current = null;
    lastUserIdRef.current = null;
    refreshGenerationRef.current += 1;
  }, [auth.subject]);
  useEffect(() => {
    userIdRef.current = user?.id ?? null;
    if (user?.id) lastUserIdRef.current = user.id;
  }, [user?.id]);

  const refresh = useCallback(async () => {
    const refreshGeneration = ++refreshGenerationRef.current;
    const refreshSubject = auth.subject;
    const isCurrentRefresh = () => refreshGenerationRef.current === refreshGeneration && authSubjectRef.current === refreshSubject;
    if (!auth.signedIn) { setUser(null); setError(null); setAccessDenied(false); setLoading(false); return; }
    if (auth.demo) { setUser(demoUser); setError(null); setAccessDenied(false); setLoading(false); return; }
    // Session validation after the first successful load is background work.
    // Keeping the existing user mounted prevents token refreshes and foreground
    // revalidation from tearing down the active navigation stack.
    setLoading(userIdRef.current === null);
    try {
      const result = await api.session();
      if (!isCurrentRefresh()) return;
      if (userIdRef.current !== result.user.id) activateUserConversationStorage(result.user.id);
      setUser(result.user); setError(null); setAccessDenied(false);
      if (userCacheKey) await AsyncStorage.setItem(userCacheKey, JSON.stringify(result.user));
      if (!isCurrentRefresh()) return;
      void registerPushNotifications(api).catch(() => undefined);
    } catch (requestError) {
      const cached = userCacheKey ? await AsyncStorage.getItem(userCacheKey) : null;
      if (!isCurrentRefresh()) return;
      if (isSessionAccessDenied(requestError)) {
        const cachedUserId = cached ? parseCachedSessionUser(cached)?.id || null : null;
        const keys = [PUSH_TOKEN_KEY];
        if (userCacheKey) keys.push(userCacheKey);
        if (cachedUserId) {
          keys.push(`csg.inbox.${cachedUserId}`, `csg.workspaces.${cachedUserId}`, `csg.workspace.active.${cachedUserId}`);
          await Promise.all([
            clearLearningCache(cachedUserId),
            clearUserConversationStorage(cachedUserId),
            clearUserSubmissionDrafts(cachedUserId),
          ].map((operation) => operation.catch(() => undefined)));
        }
        if (!isCurrentRefresh()) return;
        await AsyncStorage.multiRemove(keys);
        if (!isCurrentRefresh()) return;
        setUser(null);
        setAccessDenied(true);
      } else if (cached && canUseCachedSession(requestError)) {
        try {
          const cachedUser = parseCachedSessionUser(cached);
          if (!cachedUser) throw new Error('Invalid cached session user');
          if (userIdRef.current !== cachedUser.id) activateUserConversationStorage(cachedUser.id);
          setUser(cachedUser);
        } catch {
          await AsyncStorage.removeItem(userCacheKey!);
          if (!isCurrentRefresh()) return;
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setError((requestError as Error).message);
    } finally {
      if (isCurrentRefresh()) setLoading(false);
    }
  }, [api, auth.demo, auth.signedIn, auth.subject, userCacheKey]);

  useEffect(() => {
    if (!auth.loaded) return undefined;
    const frame = requestAnimationFrame(() => void refresh());
    return () => {
      cancelAnimationFrame(frame);
      refreshGenerationRef.current += 1;
    };
  }, [auth.loaded, auth.signedIn, auth.subject, refresh]);
  const signOut = useCallback(async () => {
    refreshGenerationRef.current += 1;
    const pushToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (pushToken && !auth.demo) await api.unregisterDevice(pushToken).catch(() => undefined);
    let cleanupUserId = (auth.demo || user?.clerk_id === auth.subject ? user?.id : null) || lastUserIdRef.current;
    if (!cleanupUserId && userCacheKey) {
      const cached = await AsyncStorage.getItem(userCacheKey);
      if (cached) cleanupUserId = parseCachedSessionUser(cached)?.id || null;
    }
    const keys = [PUSH_TOKEN_KEY];
    if (userCacheKey) keys.push(userCacheKey);
    if (cleanupUserId) keys.push(`csg.inbox.${cleanupUserId}`, `csg.workspaces.${cleanupUserId}`, `csg.workspace.active.${cleanupUserId}`);
    if (cleanupUserId) await Promise.all([
      clearLearningCache(cleanupUserId),
      clearUserConversationStorage(cleanupUserId),
      clearUserSubmissionDrafts(cleanupUserId),
    ].map((operation) => operation.catch(() => undefined)));
    await AsyncStorage.multiRemove(keys);
    await auth.signOut();
    lastUserIdRef.current = null;
  }, [api, auth, user, userCacheKey]);
  const visibleUser = auth.demo || user?.clerk_id === auth.subject ? user : null;
  const value = useMemo(() => ({ api, user: visibleUser, loading, error, accessDenied, refresh, signOut }), [api, visibleUser, loading, error, accessDenied, refresh, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within SessionProvider');
  return value;
}
