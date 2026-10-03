import type { WorkspaceSummary } from '../types/api'

export function workspaceIdForCohort(workspaces: WorkspaceSummary[], cohortId: number | null) {
  if (!cohortId) return null
  return workspaces.find((workspace) => workspace.cohort_id === cohortId)?.id ?? null
}

export function initialScopedWorkspaceId({
  workspaces,
  routedWorkspaceId,
  requestedWorkspaceId,
  cohortWorkspaceId,
}: {
  workspaces: WorkspaceSummary[]
  routedWorkspaceId: number | null | undefined
  requestedWorkspaceId: number | null
  cohortWorkspaceId: number | null | undefined
}) {
  const available = new Set(workspaces.map((workspace) => workspace.id))
  return [routedWorkspaceId, requestedWorkspaceId, cohortWorkspaceId]
    .find((workspaceId) => Boolean(workspaceId && available.has(workspaceId)))
    ?? workspaces[0]?.id
    ?? null
}

export function shouldKeepMessageTarget(targetWorkspaceId: number | null | undefined, workspaceId: number) {
  return targetWorkspaceId === workspaceId
}

export function resolveTargetWorkspaceSync({
  targetWorkspaceId,
  selectedWorkspaceId,
  pendingCohortWorkspaceId,
}: {
  targetWorkspaceId: number
  selectedWorkspaceId: number | null
  pendingCohortWorkspaceId: number | null
}) {
  if (pendingCohortWorkspaceId !== null) {
    return targetWorkspaceId === pendingCohortWorkspaceId ? 'complete' : 'wait'
  }
  return selectedWorkspaceId !== null && selectedWorkspaceId !== targetWorkspaceId ? 'promote' : 'stay'
}
