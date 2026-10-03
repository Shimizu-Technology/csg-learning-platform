import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';

import type { WorkspaceSummary } from '@/lib/types';
import { activeWorkspaceCacheKey, useWorkspace, WorkspaceProvider } from '../workspace-provider';

const workspaces = [
  { id: 11, cohort_id: 1, workspace_type: 'cohort' },
  { id: 22, cohort_id: 2, workspace_type: 'cohort' },
  { id: 99, cohort_id: null, workspace_type: 'community' },
] as WorkspaceSummary[];
const mockSelectCohort = jest.fn().mockResolvedValue(undefined);
const mockCohortState = { current: { selectedCohortId: 2 as number | null, selectCohort: mockSelectCohort } };
const mockWorkspacesRequest = jest.fn().mockResolvedValue({ workspaces });

jest.mock('../auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('../session-provider', () => ({
  useSession: () => ({ api: { workspaces: mockWorkspacesRequest }, user: { id: 7 } }),
}));
jest.mock('../cohort-provider', () => ({ useCohort: () => mockCohortState.current }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

let observedWorkspace: ReturnType<typeof useWorkspace> | null = null;

function WorkspaceObserver() {
  const workspace = useWorkspace();
  useEffect(() => { observedWorkspace = workspace; }, [workspace]);
  return <Text>{workspace.activeWorkspaceId ?? 'none'}</Text>;
}

beforeEach(async () => {
  jest.restoreAllMocks();
  global.requestAnimationFrame = (callback) => { callback(0); return 0; };
  observedWorkspace = null;
  mockCohortState.current = { selectedCohortId: 2, selectCohort: mockSelectCohort };
  mockWorkspacesRequest.mockReset();
  mockWorkspacesRequest.mockResolvedValue({ workspaces });
  mockSelectCohort.mockClear();
  await AsyncStorage.clear();
});

it('uses the global cohort workspace instead of an independently cached workspace', async () => {
  await AsyncStorage.setItem(activeWorkspaceCacheKey(7), '99');
  render(<WorkspaceProvider><WorkspaceObserver /></WorkspaceProvider>);

  await waitFor(() => expect(observedWorkspace?.activeWorkspaceId).toBe(22));
  expect(await AsyncStorage.getItem(activeWorkspaceCacheKey(7))).toBe('22');
});

it('updates the global cohort when a cohort-backed workspace is selected', async () => {
  render(<WorkspaceProvider><WorkspaceObserver /></WorkspaceProvider>);
  await waitFor(() => expect(observedWorkspace?.activeWorkspaceId).toBe(22));

  await act(async () => { await observedWorkspace?.selectWorkspace(11); });

  expect(mockSelectCohort).toHaveBeenCalledWith(1);
  expect(await AsyncStorage.getItem(activeWorkspaceCacheKey(7))).toBe('11');
});

it('keeps community messages as a workspace-only override', async () => {
  render(<WorkspaceProvider><WorkspaceObserver /></WorkspaceProvider>);
  await waitFor(() => expect(observedWorkspace?.activeWorkspaceId).toBe(22));

  await act(async () => { await observedWorkspace?.selectWorkspace(99); });

  expect(observedWorkspace?.activeWorkspaceId).toBe(99);
  expect(mockSelectCohort).not.toHaveBeenCalled();
});

it('moves messages when the global cohort changes', async () => {
  const view = render(<WorkspaceProvider><WorkspaceObserver /></WorkspaceProvider>);
  await waitFor(() => expect(observedWorkspace?.activeWorkspaceId).toBe(22));

  mockCohortState.current = { selectedCohortId: 1, selectCohort: mockSelectCohort };
  view.rerender(<WorkspaceProvider><WorkspaceObserver /></WorkspaceProvider>);

  await waitFor(() => expect(observedWorkspace?.activeWorkspaceId).toBe(11));
});

it('clears the previous cohort workspace when the selected cohort has no workspace', async () => {
  const view = render(<WorkspaceProvider><WorkspaceObserver /></WorkspaceProvider>);
  await waitFor(() => expect(observedWorkspace?.activeWorkspaceId).toBe(22));

  mockCohortState.current = { selectedCohortId: 3, selectCohort: mockSelectCohort };
  view.rerender(<WorkspaceProvider><WorkspaceObserver /></WorkspaceProvider>);

  await waitFor(() => expect(observedWorkspace?.activeWorkspaceId).toBeNull());
  expect(await AsyncStorage.getItem(activeWorkspaceCacheKey(7))).toBeNull();
});

it('preserves an explicit community override when the selected cohort has no workspace', async () => {
  const view = render(<WorkspaceProvider><WorkspaceObserver /></WorkspaceProvider>);
  await waitFor(() => expect(observedWorkspace?.activeWorkspaceId).toBe(22));
  await act(async () => { await observedWorkspace?.selectWorkspace(99); });

  mockCohortState.current = { selectedCohortId: 3, selectCohort: mockSelectCohort };
  view.rerender(<WorkspaceProvider><WorkspaceObserver /></WorkspaceProvider>);

  await waitFor(() => expect(observedWorkspace?.activeWorkspaceId).toBe(99));
  expect(await AsyncStorage.getItem(activeWorkspaceCacheKey(7))).toBe('99');

  mockCohortState.current = { selectedCohortId: 2, selectCohort: mockSelectCohort };
  view.rerender(<WorkspaceProvider><WorkspaceObserver /></WorkspaceProvider>);
  await waitFor(() => expect(observedWorkspace?.activeWorkspaceId).toBe(22));
});

it('reconciles an in-flight refresh against the latest cohort selection', async () => {
  let resolveRequest!: (value: { workspaces: WorkspaceSummary[] }) => void;
  mockWorkspacesRequest.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
  const view = render(<WorkspaceProvider><WorkspaceObserver /></WorkspaceProvider>);

  mockCohortState.current = { selectedCohortId: 1, selectCohort: mockSelectCohort };
  view.rerender(<WorkspaceProvider><WorkspaceObserver /></WorkspaceProvider>);
  await act(async () => { resolveRequest({ workspaces }); });

  await waitFor(() => expect(observedWorkspace?.activeWorkspaceId).toBe(11));
  expect(await AsyncStorage.getItem(activeWorkspaceCacheKey(7))).toBe('11');
});

it('does not advance in-memory selection when persistence fails and remains retryable', async () => {
  const view = render(<WorkspaceProvider><WorkspaceObserver /></WorkspaceProvider>);
  await waitFor(() => expect(observedWorkspace?.activeWorkspaceId).toBe(22));
  const originalSetItem = (AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
  let failSelectionWrite = true;
  const setItem = jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
    if (key === activeWorkspaceCacheKey(7) && value === '11' && failSelectionWrite) {
      failSelectionWrite = false;
      throw new Error('storage unavailable');
    }
    return originalSetItem(key, value);
  });

  mockCohortState.current = { selectedCohortId: 1, selectCohort: mockSelectCohort };
  view.rerender(<WorkspaceProvider><WorkspaceObserver /></WorkspaceProvider>);
  await waitFor(() => expect(setItem).toHaveBeenCalledWith(activeWorkspaceCacheKey(7), '11'));
  expect(observedWorkspace?.activeWorkspaceId).toBe(22);

  mockWorkspacesRequest.mockResolvedValueOnce({ workspaces: [...workspaces] });
  await act(async () => { await observedWorkspace?.refresh(); });
  await waitFor(() => expect(observedWorkspace?.activeWorkspaceId).toBe(11));
  await waitFor(async () => expect(await AsyncStorage.getItem(activeWorkspaceCacheKey(7))).toBe('11'));
});
