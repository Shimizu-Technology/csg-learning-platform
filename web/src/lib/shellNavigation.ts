import { Sun, Layers3, Users, ClipboardCheck, LifeBuoy, Library, MessageCircle, Bell, PlayCircle, CalendarDays, Activity, ShieldAlert, Contact, BookOpenText, Link2, Ellipsis, Settings } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AccessibleCohort } from '../types/api'
import { learnerCohortPath } from './routes'

export interface ShellNavItem { to: string; icon: LucideIcon; label: string; exact?: boolean }
interface Options { staff: boolean; admin: boolean; cohort: AccessibleCohort | null; cohorts?: AccessibleCohort[]; schoolFeatures?: Record<string, boolean>; loading?: boolean; alumniOnly?: boolean }

/** Staff management is always reachable; learner features follow enrollment capabilities. */
export function shellNavigation({ staff, admin, cohort, cohorts, schoolFeatures, alumniOnly }: Options): Record<'primary' | 'more' | 'admin', ShellNavItem[]> {
  const features = cohort?.capabilities?.features || cohort?.features || schoolFeatures
  const enabled = (key: string) => features?.[key] !== false
  if (staff) return {
    primary: [
      { to: '/admin', icon: Sun, label: 'Today', exact: true },
      { to: '/admin/cohorts', icon: Layers3, label: 'Cohorts' },
      { to: '/admin/students', icon: Users, label: 'Students' },
      { to: '/admin/grading', icon: ClipboardCheck, label: 'Grading' },
      { to: '/admin/support', icon: LifeBuoy, label: 'Support' },
      { to: '/admin/content', icon: Library, label: 'Content' },
      { to: '/messages', icon: MessageCircle, label: 'Messages' },
    ],
    more: [
      { to: '/announcements', icon: Bell, label: 'Updates' },
      { to: '/recordings', icon: PlayCircle, label: 'Recordings' },
      { to: '/admin/meetings', icon: CalendarDays, label: 'Meetings' },
    ],
    admin: admin ? [
      { to: '/admin/activity', icon: Activity, label: 'School activity' },
      { to: '/admin/team', icon: Contact, label: 'Team' },
      { to: '/admin/moderation', icon: ShieldAlert, label: 'Safety' },
    ] : [],
  }
  const live = !cohort || cohort.capabilities?.live_support === true
  const meetingCohort = cohorts?.find(item => item.capabilities?.live_support && (item.capabilities.features || item.features)?.private_meetings !== false)
  return {
    primary: [
      { to: '/dashboard', icon: Sun, label: 'Today', exact: true },
      { to: '/materials', icon: BookOpenText, label: 'Learn' },
      { to: cohort?.workspace_id ? `/messages?workspace_id=${cohort.workspace_id}` : '/messages', icon: MessageCircle, label: 'Messages' },
    ],
    more: [
      // The redesign folds cohort home into Learn (C-2), so the item goes with it. Only an explicit on does.
      ...(live && cohort && features?.student_experience_v2 !== true ? [{ to: learnerCohortPath(cohort.id), icon: Layers3, label: 'My cohort' }] : []),
      ...(meetingCohort || (live && enabled('private_meetings')) ? [{ to: meetingCohort ? `/meetings?cohort_id=${meetingCohort.id}` : '/meetings', icon: CalendarDays, label: 'My meetings' }] : []),
      ...(live && enabled('recordings') && !alumniOnly ? [{ to: '/recordings', icon: PlayCircle, label: 'Recordings' }] : []),
      { to: '/resources', icon: Link2, label: 'Resources' },
      ...(enabled('announcements') ? [{ to: cohort ? `/announcements?cohort_id=${cohort.id}` : '/announcements', icon: Bell, label: 'Updates' }] : []),
    ], admin: [],
  }
}
// Reserved disclosure icons stay distinct from every destination icon.
export const moreIcon = Ellipsis
export const adminIcon = Settings
