import { Sun, Layers3, Users, ClipboardCheck, LifeBuoy, Library, MessageCircle, Bell, PlayCircle, CalendarDays, Activity, ShieldAlert, Contact, BookOpenText, Link2, Ellipsis, Settings } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AccessibleCohort } from '../types/api'
import { learnerCohortPath } from './routes'

export interface ShellNavItem { to: string; icon: LucideIcon; label: string; exact?: boolean }
interface Options { staff: boolean; admin: boolean; cohort: AccessibleCohort | null; schoolFeatures?: Record<string, boolean>; loading?: boolean; alumniOnly?: boolean }

/** School switches scope global staff pages; learner permissions come from the selected enrollment. */
export function shellNavigation({ staff, admin, cohort, schoolFeatures, loading, alumniOnly }: Options): Record<'primary' | 'more' | 'admin', ShellNavItem[]> {
  if (loading) return { primary: [], more: [], admin: [] }
  const features = staff ? schoolFeatures : cohort?.capabilities?.features || cohort?.features || schoolFeatures
  const enabled = (key: string) => features?.[key] !== false
  if (staff) return {
    primary: [
      { to: '/admin', icon: Sun, label: 'Today', exact: true },
      { to: '/admin/cohorts', icon: Layers3, label: 'Cohorts' },
      { to: '/admin/students', icon: Users, label: 'Students' },
      { to: '/admin/grading', icon: ClipboardCheck, label: 'Grading' },
      ...(enabled('help_requests') || enabled('interventions') ? [{ to: '/admin/support', icon: LifeBuoy, label: 'Support' }] : []),
      { to: '/admin/content', icon: Library, label: 'Content' },
      { to: '/messages', icon: MessageCircle, label: 'Messages' },
    ],
    more: [
      ...(enabled('announcements') ? [{ to: '/announcements', icon: Bell, label: 'Updates' }] : []),
      ...(enabled('recordings') ? [{ to: '/recordings', icon: PlayCircle, label: 'Recordings' }] : []),
      ...(enabled('private_meetings') ? [{ to: '/admin/meetings', icon: CalendarDays, label: 'Meetings' }] : []),
    ],
    admin: admin ? [
      { to: '/admin/activity', icon: Activity, label: 'School activity' },
      { to: '/admin/team', icon: Contact, label: 'Team' },
      { to: '/admin/moderation', icon: ShieldAlert, label: 'Safety' },
    ] : [],
  }
  const live = cohort?.capabilities?.live_support === true
  return {
    primary: [
      { to: '/dashboard', icon: Sun, label: 'Today', exact: true },
      { to: '/materials', icon: BookOpenText, label: 'Learn' },
      { to: cohort?.workspace_id ? `/messages?workspace_id=${cohort.workspace_id}` : '/messages', icon: MessageCircle, label: 'Messages' },
    ],
    more: [
      ...(live && cohort ? [{ to: learnerCohortPath(cohort.id), icon: Layers3, label: 'My cohort' }] : []),
      ...(live && enabled('private_meetings') ? [{ to: '/meetings', icon: CalendarDays, label: 'My meetings' }] : []),
      ...(live && enabled('recordings') && !alumniOnly ? [{ to: '/recordings', icon: PlayCircle, label: 'Recordings' }] : []),
      { to: '/resources', icon: Link2, label: 'Resources' },
      ...(enabled('announcements') ? [{ to: cohort ? `/announcements?cohort_id=${cohort.id}` : '/announcements', icon: Bell, label: 'Updates' }] : []),
    ], admin: [],
  }
}
// Reserved disclosure icons stay distinct from every destination icon.
export const moreIcon = Ellipsis
export const adminIcon = Settings
