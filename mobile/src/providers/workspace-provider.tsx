import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { demoWorkspaces } from '@/lib/demo-data';
import type { WorkspaceSummary } from '@/lib/types';
import { resolveActiveWorkspaceId, workspaceIdForCohort } from '@/lib/workspaces';
import { useCsgAuth } from './auth-provider';
import { useCohort } from './cohort-provider';
import { useSession } from './session-provider';

interface WorkspaceValue {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: number | null;
  activeWorkspace: WorkspaceSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  selectWorkspace: (workspaceId: number) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function workspaceCacheKey(userId: number) { return `csg.workspaces.${userId}`; }
export function activeWorkspaceCacheKey(userId: number) { return `csg.workspace.active.${userId}`; }

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const { selectedCohortId, selectCohort } = useCohort();
  const userId = user?.id ?? null;
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>(auth.demo ? demoWorkspaces : []);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(auth.demo ? demoWorkspaces[0]?.id ?? null : null);
  const [loading, setLoading] = useState(!auth.demo);
  const [error, setError] = useState<string | null>(null);
  const workspaceCountRef = useRef(workspaces.length);
  const activeUserIdRef = useRef<number | null>(userId);
  const selectedCohortIdRef = useRef(selectedCohortId);
  const communityOverrideRef = useRef<{ workspaceId: number; cohortId: number | null } | null>(null);
  const lastAppliedCohortWorkspaceRef = useRef<string | null | undefined>(undefined);
  const persistenceGenerationRef = useRef(0);
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  useLayoutEffect(() => {
    selectedCohortIdRef.current = selectedCohortId;
  }, [selectedCohortId]);
  useEffect(() => {
    workspaceCountRef.current = workspaces.length;
  }, [workspaces.length]);

  const persistWorkspaceSelection = useCallback(async (workspaceId: number | null, isCurrent: () => boolean) => {
    if (!userId) return false;
    const generation = ++persistenceGenerationRef.current;
    let applied = false;
    const operation = persistenceQueueRef.current.catch(() => undefined).then(async () => {
      if (generation !== persistenceGenerationRef.current || !isCurrent()) return;
      const key = activeWorkspaceCacheKey(userId);
      if (workspaceId === null) await AsyncStorage.removeItem(key);
      else await AsyncStorage.setItem(key, String(workspaceId));
      if (generation !== persistenceGenerationRef.current || !isCurrent()) return;
      applied = true;
    });
    persistenceQueueRef.current = operation.catch(() => undefined);
    await operation;
    return applied;
  }, [userId]);

  const resolveCurrentWorkspace = useCallback((nextWorkspaces: WorkspaceSummary[], storedId: number | null) => {
    const cohortId = selectedCohortIdRef.current;
    const cohortWorkspaceId = workspaceIdForCohort(nextWorkspaces, cohortId);
    const override = communityOverrideRef.current;
    const accessibleOverride = override && nextWorkspaces.some((workspace) => workspace.id === override.workspaceId && workspace.workspace_type === 'community')
      ? override
      : null;
    if (override && !accessibleOverride) communityOverrideRef.current = null;
    if (cohortWorkspaceId && accessibleOverride?.cohortId !== cohortId) {
      communityOverrideRef.current = null;
      return cohortWorkspaceId;
    }
    if (accessibleOverride) {
      if (!cohortWorkspaceId && accessibleOverride.cohortId !== cohortId) {
        accessibleOverride.cohortId = cohortId;
      }
      return accessibleOverride.workspaceId;
    }
    return cohortId === null ? resolveActiveWorkspaceId(nextWorkspaces, storedId) : cohortWorkspaceId;
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) {
      setWorkspaces([]);
      setActiveWorkspaceId(null);
      setLoading(false);
      return;
    }
    // Only block the screen while a user has no workspace data yet. Subsequent
    // refreshes retain the current workspace and update it in place.
    setLoading(workspaceCountRef.current === 0);
    const listKey = workspaceCacheKey(userId);
    const activeKey = activeWorkspaceCacheKey(userId);
    try {
      const nextWorkspaces = auth.demo ? demoWorkspaces : (await api.workspaces()).workspaces;
      const storedId = Number(await AsyncStorage.getItem(activeKey)) || null;
      const nextActiveId = resolveCurrentWorkspace(nextWorkspaces, storedId);
      setWorkspaces(nextWorkspaces);
      if (selectedCohortIdRef.current === null || communityOverrideRef.current) {
        setActiveWorkspaceId(nextActiveId);
      }
      setError(null);
      await AsyncStorage.setItem(listKey, JSON.stringify(nextWorkspaces));
    } catch (requestError) {
      const [cachedList, cachedActive] = await Promise.all([AsyncStorage.getItem(listKey), AsyncStorage.getItem(activeKey)]);
      if (cachedList) {
        try {
          const cachedWorkspaces = JSON.parse(cachedList) as WorkspaceSummary[];
          setWorkspaces(cachedWorkspaces);
          const cachedActiveId = resolveCurrentWorkspace(cachedWorkspaces, Number(cachedActive) || null);
          if (selectedCohortIdRef.current === null || communityOverrideRef.current) {
            setActiveWorkspaceId(cachedActiveId);
          }
        } catch {
          await AsyncStorage.multiRemove([listKey, activeKey]);
          setWorkspaces([]);
          setActiveWorkspaceId(null);
        }
      }
      setError((requestError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, auth.demo, resolveCurrentWorkspace, userId]);

  useEffect(() => {
    const nextUserId = userId;
    if (activeUserIdRef.current !== nextUserId) {
      activeUserIdRef.current = nextUserId;
      persistenceGenerationRef.current += 1;
      communityOverrideRef.current = null;
      lastAppliedCohortWorkspaceRef.current = undefined;
      setWorkspaces(auth.demo ? demoWorkspaces : []);
      setActiveWorkspaceId(auth.demo ? demoWorkspaces[0]?.id ?? null : null);
      workspaceCountRef.current = auth.demo ? demoWorkspaces.length : 0;
    }
    const frame = requestAnimationFrame(() => void refresh());
    return () => cancelAnimationFrame(frame);
  }, [auth.demo, refresh, userId]);

  useEffect(() => {
    if (!userId) {
      lastAppliedCohortWorkspaceRef.current = undefined;
      return;
    }
    if (selectedCohortId === null) {
      lastAppliedCohortWorkspaceRef.current = null;
      return;
    }
    const workspaceId = workspaceIdForCohort(workspaces, selectedCohortId);
    const override = communityOverrideRef.current;
    if (override && !workspaceId) {
      override.cohortId = selectedCohortId;
      return;
    }
    if (override?.cohortId === selectedCohortId) return;
    communityOverrideRef.current = null;
    const selectionKey = `${selectedCohortId}:${workspaceId ?? 'none'}`;
    if (lastAppliedCohortWorkspaceRef.current === selectionKey) return;
    const isCurrent = () => activeUserIdRef.current === userId && selectedCohortIdRef.current === selectedCohortId && communityOverrideRef.current === null;
    void persistWorkspaceSelection(workspaceId, isCurrent).then((applied) => {
      if (!applied) return;
      lastAppliedCohortWorkspaceRef.current = selectionKey;
      setActiveWorkspaceId(workspaceId);
    }).catch((storageError) => {
      if (isCurrent()) setError((storageError as Error).message);
    });
  }, [persistWorkspaceSelection, selectedCohortId, userId, workspaces]);

  const selectWorkspace = useCallback(async (workspaceId: number) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!userId || !workspace) return;
    const override = workspace.workspace_type === 'community'
      ? { workspaceId, cohortId: selectedCohortIdRef.current }
      : null;
    communityOverrideRef.current = override;
    const isCurrent = () => activeUserIdRef.current === userId && communityOverrideRef.current === override;
    try {
      const applied = await persistWorkspaceSelection(workspaceId, isCurrent);
      if (!applied) return;
      lastAppliedCohortWorkspaceRef.current = override ? `community:${workspaceId}` : null;
      setActiveWorkspaceId(workspaceId);
      if (workspace.cohort_id) await selectCohort(workspace.cohort_id);
    } catch (storageError) {
      if (isCurrent()) {
        if (override) communityOverrideRef.current = null;
        setError((storageError as Error).message);
      }
    }
  }, [persistWorkspaceSelection, selectCohort, userId, workspaces]);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );
  const value = useMemo(() => ({ workspaces, activeWorkspaceId, activeWorkspace, loading, error, refresh, selectWorkspace }), [workspaces, activeWorkspaceId, activeWorkspace, loading, error, refresh, selectWorkspace]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return value;
}
