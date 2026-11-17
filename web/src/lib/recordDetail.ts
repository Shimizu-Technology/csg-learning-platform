import { useAuthContext } from '../contexts/AuthContext'
import { api } from './api'
import { useStaffResource } from './useStaffResource'
import type {
  ActivityEventDetail, ChannelDetail, ContentReportDetail, LearningPlanDetail, OfferingDetail, OfficeHourDetail, PrivateMeetingDetail, RecordingDetail,
  RecoveryPlanDetail, RubricDetail,
} from '../types/api'

/*
 * The staff record pages added in L-5.2 (a recording, office-hour session,
 * private-meeting booking, learning plan, channel, rubric, activity event and
 * return plan, and for admins a community report and an offering's purchases)
 * read GET /api/v1/records/:type/:id/detail. The server answers 404 for
 * anything the viewer can't open, including every record for a student.
 */

export type DetailType = 'recording' | 'office_hour' | 'private_meeting' | 'learning_plan' | 'channel' | 'rubric' | 'activity_event' | 'recovery_plan' | 'content_report' | 'offering'
interface DetailTypes {
  recording: RecordingDetail
  office_hour: OfficeHourDetail
  private_meeting: PrivateMeetingDetail
  learning_plan: LearningPlanDetail
  channel: ChannelDetail
  rubric: RubricDetail
  activity_event: ActivityEventDetail
  recovery_plan: RecoveryPlanDetail
  content_report: ContentReportDetail
  offering: OfferingDetail
}

export interface DetailState<T> {
  detail: T | null
  loading: boolean
  error: string | null
  /** True when the server answered 404: no such record, or the viewer may not open it. */
  missing: boolean
  reload: () => Promise<void>
}

/** Loads one record page for the signed-in viewer, scoped by viewer and record. `id` null waits. */
export function useRecordDetail<T extends DetailType>(type: T, id: number | null | undefined): DetailState<DetailTypes[T]> {
  const viewerId = useAuthContext().user?.id ?? ''
  const valid = typeof id === 'number' && Number.isInteger(id) && id > 0
  const scope = valid ? `${viewerId}|detail:${type}:${id}` : 'none'
  const { data, loading, error, reload } = useStaffResource<{ detail: DetailTypes[T] | null; missing: boolean }>(scope, async () => {
    if (!valid) return { data: { detail: null, missing: true } }
    const result = await api.getRecordDetail(type, id)
    if (result.status === 404 || result.status === 403) return { data: { detail: null, missing: true } }
    const detail = result.data?.detail
    // A body for another record type is treated as missing, never shown on the wrong page.
    if (detail && detail.type !== type) return { data: { detail: null, missing: true } }
    return { data: detail ? { detail: detail as DetailTypes[T], missing: false } : null, error: result.error }
  })
  return { detail: data?.detail ?? null, missing: Boolean(data?.missing), loading, error, reload }
}
