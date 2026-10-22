import type { AccessibleCohort, SessionUser, WorkspaceSummary } from './types';

export const sharedLibraryReadOnlyNotice = 'Only admins can change the shared course library.';

export function isAuthoringAdmin(user: SessionUser | null) {
  return Boolean(user?.is_admin || user?.role === 'admin');
}

export function canManageWorkspaceChannels(user: SessionUser | null, workspace: WorkspaceSummary | null, assignedCohorts: Pick<AccessibleCohort, 'id'>[]) {
  if (!user?.is_staff || !workspace) return false;
  if (workspace.workspace_type === 'community') return isAuthoringAdmin(user) && workspace.can_manage;
  // can_manage describes community membership/settings, not cohort channel authority.
  return isAuthoringAdmin(user) || assignedCohorts.some((cohort) => cohort.id === workspace.cohort_id);
}
