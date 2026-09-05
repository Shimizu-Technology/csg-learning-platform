import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { CsgApi } from '@/lib/api';
import { demoUser } from '@/lib/demo-data';
import { PUSH_TOKEN_KEY, registerPushNotifications } from '@/lib/push-notifications';
import { clearLearningCache } from '@/lib/learning-cache';
import { activateUserConversationStorage, clearUserConversationStorage } from '@/lib/conversation-storage';
import { canUseCachedSession, isSessionAccessDenied, parseCachedSessionUser, serializeCachedSessionUser } from '@/lib/session-access';
import { clearUserSubmissionDrafts } from '@/lib/submission-storage';
import { beginUserStorageCleanup } from '@/lib/user-storage-lifecycle';
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
  const [sessionSubject, setSessionSubject] = useState<string | null>(auth.demo ? 'demo' : null);
  const [loading, setLoading] = useState(!auth.demo);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const userIdRef = useRef<number | null>(user?.id ?? null);
  const lastUserIdRef = useRef<number | null>(user?.id ?? null);
  const refreshGenerationRef = useRef(0);
  const sessionCacheWriteRef = useRef<Promise<void>>(Promise.resolve());
  const pushRegistrationRef = useRef<Promise<void>>(Promise.resolve());
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
    if (!auth.signedIn) { setUser(null); setSessionSubject(null); setError(null); setAccessDenied(false); setLoading(false); return; }
    if (auth.demo) { setUser(demoUser); setSessionSubject('demo'); setError(null); setAccessDenied(false); setLoading(false); return; }
    if (!refreshSubject) {
      setUser(null); setSessionSubject(null); setError('We could not verify the signed-in account. Please sign in again.'); setAccessDenied(false); setLoading(false); return;
    }
    // Session validation after the first successful load is background work.
    // Keeping the existing user mounted prevents token refreshes and foreground
    // revalidation from tearing down the active navigation stack.
    setLoading(userIdRef.current === null);
    try {
      const result = await api.session();
      if (!isCurrentRefresh()) return;
      activateUserConversationStorage(result.user.id);
      setUser(result.user); setSessionSubject(refreshSubject); setError(null); setAccessDenied(false);
      // The authenticated server session is authoritative. A device-storage
      // failure must not turn a valid sign-in into a session failure.
      if (userCacheKey) {
        const serializedUser = serializeCachedSessionUser(result.user, refreshSubject);
        const cacheWrite = sessionCacheWriteRef.current.catch(() => undefined).then(async () => {
          if (!isCurrentRefresh()) return;
          await AsyncStorage.setItem(userCacheKey, serializedUser);
          if (!isCurrentRefresh()) await AsyncStorage.removeItem(userCacheKey);
        });
        sessionCacheWriteRef.current = cacheWrite.catch(() => undefined);
      }
      const pushRegistration = pushRegistrationRef.current.catch(() => undefined).then(async () => {
        if (!isCurrentRefresh()) return;
        await registerPushNotifications(api, isCurrentRefresh);
      });
      pushRegistrationRef.current = pushRegistration.catch(() => undefined);
    } catch (requestError) {
      const cached = userCacheKey ? await AsyncStorage.getItem(userCacheKey).catch(() => null) : null;
      // A superseded denial must not delete credentials or caches written by a
      // newer refresh for the same subject.
      if (!isCurrentRefresh()) return;
      const cachedUser = cached ? parseCachedSessionUser(cached, refreshSubject) : null;
      if (isSessionAccessDenied(requestError)) {
        const cleanupUserId = userIdRef.current || cachedUser?.id || null;
        const keys = [PUSH_TOKEN_KEY];
        if (userCacheKey) keys.push(userCacheKey);
        if (cleanupUserId) {
          const cleanup = beginUserStorageCleanup(cleanupUserId);
          keys.push(`csg.inbox.${cleanupUserId}`, `csg.workspaces.${cleanupUserId}`, `csg.workspace.active.${cleanupUserId}`);
          await Promise.all([
            clearLearningCache(cleanupUserId, cleanup),
            clearUserConversationStorage(cleanupUserId, cleanup),
            clearUserSubmissionDrafts(cleanupUserId, cleanup),
          ].map((operation) => operation.catch(() => undefined)));
        }
        if (!isCurrentRefresh()) return;
        await AsyncStorage.multiRemove(keys).catch(() => undefined);
        if (!isCurrentRefresh()) return;
        setUser(null);
        setSessionSubject(null);
        setAccessDenied(true);
      } else if (canUseCachedSession(requestError)) {
        if (cachedUser) {
          activateUserConversationStorage(cachedUser.id);
          setUser(cachedUser);
          setSessionSubject(refreshSubject);
        } else {
          if (cached && userCacheKey) await AsyncStorage.removeItem(userCacheKey).catch(() => undefined);
          if (!isCurrentRefresh()) return;
          setUser(null);
          setSessionSubject(null);
        }
      } else {
        setUser(null);
        setSessionSubject(null);
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
    try {
      const pushToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY).catch(() => null);
      if (pushToken && !auth.demo) await api.unregisterDevice(pushToken).catch(() => undefined);
      let cleanupUserId = (auth.demo || sessionSubject === auth.subject ? user?.id : null) || lastUserIdRef.current;
      if (!cleanupUserId && userCacheKey) {
        const cached = await AsyncStorage.getItem(userCacheKey).catch(() => null);
        const cachedUser = cached && auth.subject ? parseCachedSessionUser(cached, auth.subject) : null;
        if (cachedUser) cleanupUserId = cachedUser.id;
      }
      const keys = [PUSH_TOKEN_KEY];
      if (userCacheKey) keys.push(userCacheKey);
      if (cleanupUserId) keys.push(`csg.inbox.${cleanupUserId}`, `csg.workspaces.${cleanupUserId}`, `csg.workspace.active.${cleanupUserId}`);
      if (cleanupUserId) {
        const cleanup = beginUserStorageCleanup(cleanupUserId);
        await Promise.all([
          clearLearningCache(cleanupUserId, cleanup),
          clearUserConversationStorage(cleanupUserId, cleanup),
          clearUserSubmissionDrafts(cleanupUserId, cleanup),
        ].map((operation) => operation.catch(() => undefined)));
      }
      await AsyncStorage.multiRemove(keys).catch(() => undefined);
    } finally {
      await auth.signOut();
      lastUserIdRef.current = null;
    }
  }, [api, auth, sessionSubject, user, userCacheKey]);
  const visibleUser = auth.demo || (auth.subject !== null && sessionSubject === auth.subject) ? user : null;
  const value = useMemo(() => ({ api, user: visibleUser, loading, error, accessDenied, refresh, signOut }), [api, visibleUser, loading, error, accessDenied, refresh, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within SessionProvider');
  return value;
}
