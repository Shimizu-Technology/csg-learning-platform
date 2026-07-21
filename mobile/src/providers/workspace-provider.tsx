import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { demoWorkspaces } from '@/lib/demo-data';
import type { WorkspaceSummary } from '@/lib/types';
import { resolveActiveWorkspaceId } from '@/lib/workspaces';
import { useCsgAuth } from './auth-provider';
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
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>(auth.demo ? demoWorkspaces : []);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(auth.demo ? demoWorkspaces[0]?.id ?? null : null);
  const [loading, setLoading] = useState(!auth.demo);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setWorkspaces([]);
      setActiveWorkspaceId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const listKey = workspaceCacheKey(user.id);
    const activeKey = activeWorkspaceCacheKey(user.id);
    try {
      const nextWorkspaces = auth.demo ? demoWorkspaces : (await api.workspaces()).workspaces;
      const storedId = Number(await AsyncStorage.getItem(activeKey)) || null;
      const nextActiveId = resolveActiveWorkspaceId(nextWorkspaces, storedId);
      setWorkspaces(nextWorkspaces);
      setActiveWorkspaceId(nextActiveId);
      setError(null);
      await AsyncStorage.setItem(listKey, JSON.stringify(nextWorkspaces));
      if (nextActiveId) await AsyncStorage.setItem(activeKey, String(nextActiveId));
      else await AsyncStorage.removeItem(activeKey);
    } catch (requestError) {
      const [cachedList, cachedActive] = await Promise.all([AsyncStorage.getItem(listKey), AsyncStorage.getItem(activeKey)]);
      if (cachedList) {
        try {
          const cachedWorkspaces = JSON.parse(cachedList) as WorkspaceSummary[];
          setWorkspaces(cachedWorkspaces);
          setActiveWorkspaceId(resolveActiveWorkspaceId(cachedWorkspaces, Number(cachedActive) || null));
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
  }, [api, auth.demo, user]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void refresh());
    return () => cancelAnimationFrame(frame);
  }, [refresh]);

  const selectWorkspace = useCallback(async (workspaceId: number) => {
    if (!user || !workspaces.some((workspace) => workspace.id === workspaceId)) return;
    setActiveWorkspaceId(workspaceId);
    await AsyncStorage.setItem(activeWorkspaceCacheKey(user.id), String(workspaceId));
  }, [user, workspaces]);

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
