import { describe, expect, it } from 'vitest'
import type { WorkspaceSummary } from '../types/api'
import { initialScopedWorkspaceId, workspaceIdForCohort } from './cohortScope'

const workspaces = [
  { id: 11, cohort_id: 1 },
  { id: 22, cohort_id: 2 },
  { id: 99, cohort_id: null },
] as WorkspaceSummary[]

describe('cohort workspace scope', () => {
  it('maps a cohort to its messaging workspace', () => {
    expect(workspaceIdForCohort(workspaces, 2)).toBe(22)
    expect(workspaceIdForCohort(workspaces, null)).toBeNull()
    expect(workspaceIdForCohort(workspaces, 404)).toBeNull()
  })

  it('starts messages in the globally selected cohort workspace', () => {
    expect(initialScopedWorkspaceId({
      workspaces,
      routedWorkspaceId: null,
      requestedWorkspaceId: null,
      cohortWorkspaceId: 22,
    })).toBe(22)
  })

  it('lets an explicit message route override the global default', () => {
    expect(initialScopedWorkspaceId({
      workspaces,
      routedWorkspaceId: 99,
      requestedWorkspaceId: 11,
      cohortWorkspaceId: 22,
    })).toBe(99)
  })

  it('ignores workspace ids that are no longer accessible', () => {
    expect(initialScopedWorkspaceId({
      workspaces,
      routedWorkspaceId: 404,
      requestedWorkspaceId: 405,
      cohortWorkspaceId: 22,
    })).toBe(22)
  })
})
