import { CheckCircle2, Circle } from 'lucide-react'
import { PreviewLink as Link } from '../../contexts/PreviewNavigationContext'
import { formatShortDate } from '../../lib/format'
import { TERMS } from '../../lib/glossary'
import { cohortPath, cohortSettingsPath } from '../../lib/routes'
import { schoolTimeDescription } from '../../lib/schoolTime'
import type { CohortDetail } from '../../types/api'
import { Badge } from '../ui/Badge'

const DELIVERY_TITLES: Record<string, string> = {
  program: TERMS.liveProgram,
  guided: TERMS.smallClass,
  self_paced: TERMS.selfPaced,
}

interface ChecklistItem {
  key: string
  label: string
  ready: boolean
  detail: string
  to: string
  actionLabel: string
}

export function CohortSetupChecklist({ cohort }: { cohort: CohortDetail }) {
  const delivery = cohort.course_delivery || 'program'
  const isPaidEligible = (delivery === 'guided' || delivery === 'self_paced') && cohort.cohort_type !== 'alumni'

  const assignedModules = cohort.modules.filter((mod) => mod.assigned)
  const earliestModuleStart = assignedModules
    .map((mod) => mod.module_start_date)
    .filter(Boolean)
    .sort()[0]

  const totalStudents = cohort.students.length
  const signedInStudents = cohort.students.filter((student) => Boolean(student.last_sign_in_at)).length
  const failedInvites = cohort.students.filter(
    (student) => !student.last_sign_in_at && student.invite_delivery_status === 'failed',
  ).length
  const uninvitedStudents = cohort.students.filter((student) => {
    if (student.last_sign_in_at || student.invite_delivery_status === 'failed') return false
    if (student.invite_delivery_status === 'not_sent') return true
    if (student.invite_delivery_status === 'sent' || student.invite_delivery_status === 'queued' || student.invite_delivery_status === 'accepted') {
      return false
    }
    return !student.invite_pending && !student.invited_at
  }).length
  const pendingInvites = totalStudents - signedInStudents - failedInvites - uninvitedStudents

  const invitationsReady = totalStudents > 0 && failedInvites === 0 && uninvitedStudents === 0
  let invitationsDetail: string
  let invitationsActionLabel: string
  if (totalStudents === 0) {
    invitationsDetail = 'No students enrolled yet. Add your roster, then send invitations from the Students tab.'
    invitationsActionLabel = 'Add students'
  } else if (failedInvites > 0) {
    invitationsDetail = `${failedInvites} ${failedInvites === 1 ? 'invitation failed' : 'invitations failed'} and needs retry on the Students tab.${uninvitedStudents > 0 ? ` ${uninvitedStudents} not yet invited.` : ''}`
    invitationsActionLabel = 'Retry failed invites'
  } else if (uninvitedStudents > 0) {
    invitationsDetail = `${uninvitedStudents} enrolled ${uninvitedStudents === 1 ? 'student has' : 'students have'} not been invited yet.${pendingInvites > 0 ? ` ${pendingInvites} awaiting sign-in.` : ''}`
    invitationsActionLabel = 'Send invitations'
  } else if (pendingInvites > 0) {
    invitationsDetail = `${signedInStudents} signed in · ${pendingInvites} invited and awaiting sign-in.`
    invitationsActionLabel = 'View invitations'
  } else {
    invitationsDetail = `All ${signedInStudents} enrolled ${signedInStudents === 1 ? 'student has' : 'students have'} signed in.`
    invitationsActionLabel = 'View students'
  }

  const readiness = cohort.offering_readiness
  const curriculumReady = Boolean(readiness ? readiness.published_content && readiness.curriculum_assigned : assignedModules.length > 0)
  const datesReady = Boolean(cohort.start_date && (delivery === 'self_paced' || assignedModules.length > 0))
  const staffingReady = isPaidEligible
    ? Boolean(cohort.instructor_assigned && cohort.support_instructor_id)
    : Boolean(cohort.instructor_assigned)

  const seatsLabel =
    cohort.seat_limit != null
      ? `${cohort.seats_taken ?? totalStudents} of ${cohort.seat_limit} seats occupied${cohort.sold_out ? ' (full)' : ''}`
      : `Unlimited seats · ${totalStudents} enrolled`

  const items: ChecklistItem[] = [
    {
      key: 'curriculum',
      label: 'Curriculum and published lessons',
      ready: curriculumReady,
      detail: curriculumReady
        ? `${assignedModules.length} assigned ${assignedModules.length === 1 ? 'module' : 'modules'} with published content.`
        : 'Assign at least one module with a published lesson before learners join.',
      to: cohortPath(cohort.id, 'learning'),
      actionLabel: 'Review curriculum',
    },
    {
      key: 'dates',
      label: 'Dates and first release',
      ready: datesReady,
      detail:
        delivery === 'self_paced'
          ? `Cohort starts ${formatShortDate(cohort.start_date, 'unscheduled')}. Self-paced learners unlock assigned modules immediately.`
          : earliestModuleStart
            ? `Cohort starts ${formatShortDate(cohort.start_date, 'unscheduled')}. First module opens ${formatShortDate(earliestModuleStart)} (${schoolTimeDescription()}).`
            : `Cohort starts ${formatShortDate(cohort.start_date, 'unscheduled')}. Assign a module to schedule the first lesson release.`,
      to: `${cohortSettingsPath(cohort.id)}#cohort-dates`,
      actionLabel: 'Check dates',
    },
    {
      key: 'staffing',
      label: isPaidEligible ? 'Teaching team and support instructor' : 'Teaching team assigned',
      ready: staffingReady,
      detail: staffingReady
        ? isPaidEligible
          ? 'Instructor assigned and support instructor chosen for learner help.'
          : 'At least one instructor is assigned to teach this cohort.'
        : isPaidEligible && cohort.instructor_assigned
          ? 'Instructor assigned, but choose a Support instructor in Course offering settings.'
          : 'Assign an instructor so grading and support requests have an owner.',
      to: isPaidEligible && cohort.instructor_assigned ? `${cohortSettingsPath(cohort.id)}#course-offering-heading` : cohortPath(cohort.id, 'team'),
      actionLabel: isPaidEligible && cohort.instructor_assigned ? 'Set support instructor' : 'Assign instructor',
    },
    {
      key: 'seats',
      label: isPaidEligible ? 'Seats and enrollment' : 'Students enrolled',
      ready: isPaidEligible ? cohort.seat_limit == null || !cohort.sold_out : totalStudents > 0,
      detail: isPaidEligible
        ? `${seatsLabel}. Staff can enroll directly or let learners join via checkout.`
        : totalStudents > 0
          ? `${totalStudents} ${totalStudents === 1 ? 'student' : 'students'} enrolled in this cohort.`
          : 'Add students individually or upload a CSV roster.',
      to: cohortPath(cohort.id, 'students'),
      actionLabel: 'Manage students',
    },
    {
      key: 'invites',
      label: 'Student invitations',
      ready: invitationsReady,
      detail: invitationsDetail,
      to: cohortPath(cohort.id, 'students'),
      actionLabel: invitationsActionLabel,
    },
  ]

  if (isPaidEligible) {
    const priceVerified = Boolean(readiness?.price_verified)
    const checkoutLive = Boolean(cohort.public_checkout_enabled && priceVerified)
    items.push({
      key: 'checkout',
      label: 'Checkout and verified Stripe price',
      ready: checkoutLive,
      detail: checkoutLive
        ? cohort.unlisted
          ? 'Stripe price verified and direct-link checkout is live.'
          : 'Stripe price verified and public catalog checkout is live.'
        : !readiness?.price_set
          ? 'Set a display price and Stripe Price ID in Settings.'
          : !priceVerified
            ? 'Verify the saved Stripe Price ID in Course offering settings before enabling checkout.'
            : 'Price verified in Stripe. Turn on checkout in Course offering settings when ready to launch.',
      to: `${cohortSettingsPath(cohort.id)}#course-offering-heading`,
      actionLabel: 'Open checkout settings',
    })
  }

  const readyCount = items.filter((item) => item.ready).length

  return (
    <section className="app-surface space-y-4 p-5" aria-labelledby="cohort-setup-checklist-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="cohort-setup-checklist-heading" className="text-lg font-bold text-ink">
              Setup checklist
            </h2>
            <Badge tone="neutral">{DELIVERY_TITLES[delivery] || delivery}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-secondary">
            Review dates, first release, staffing, seats, invitations{isPaidEligible ? ', and checkout' : ''} before
            launch.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tabular-nums text-ink-muted">
            {readyCount} of {items.length} ready
          </span>
          <Link className="app-link inline-flex min-h-11 items-center text-sm font-semibold" to={cohortSettingsPath(cohort.id)}>
            Settings
          </Link>
        </div>
      </div>

      <ul className="divide-y divide-line rounded-xl border border-line">
        {items.map((item) => {
          const Icon = item.ready ? CheckCircle2 : Circle
          return (
            <li key={item.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-2.5">
                <Icon
                  className={`mt-0.5 h-5 w-5 shrink-0 ${item.ready ? 'text-success-ink' : 'text-ink-muted'}`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    <span className="sr-only">{item.ready ? 'Ready: ' : 'Needed: '}</span>
                    {item.label}
                  </p>
                  <p className="text-xs leading-5 text-ink-secondary">{item.detail}</p>
                </div>
              </div>
              <Link
                to={item.to}
                className="app-link inline-flex min-h-11 shrink-0 items-center text-sm font-semibold sm:min-h-0"
              >
                {item.actionLabel}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
