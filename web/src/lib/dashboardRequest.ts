import { api } from './api'

/*
 * Today's dashboard request, started before the new-student-experience switch
 * is known (W8 PR 8.2 fix round). `/dashboard` used to wait for the cohort list
 * to resolve the switch before either view asked for its data; now TodayRoute
 * starts the request at once, and whichever view renders (today's Dashboard
 * or the redesigned Today) takes it instead of asking again. A request nobody
 * takes is dropped a little after it settles, so a later visit never reads
 * old data. The redesigned lesson page (W8.3) can use the same pattern for its
 * lesson request.
 */
type DashboardResult = ReturnType<typeof api.getDashboard>

const UNCLAIMED_MS = 5_000
const started = new Map<string, DashboardResult>()
const key = (cohortId?: number | null) => String(cohortId ?? '')

/** Start the dashboard request for this cohort now, unless one is already waiting to be taken. */
export function startDashboardRequest(cohortId?: number | null) {
  const id = key(cohortId)
  if (started.has(id)) return
  const request = api.getDashboard(cohortId ?? undefined)
  started.set(id, request)
  const forget = () => { setTimeout(() => { if (started.get(id) === request) started.delete(id) }, UNCLAIMED_MS) }
  request.then(forget, forget)
}

/** The started request for this cohort if there is one (taken once), otherwise a new one. */
export function takeDashboardRequest(cohortId?: number | null): DashboardResult {
  const id = key(cohortId)
  const request = started.get(id)
  started.delete(id)
  return request ?? api.getDashboard(cohortId ?? undefined)
}
