// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import type { ReleaseCommunications } from '../../types/api'
import { ReleaseCommunicationsPanel } from './ReleaseCommunicationsPanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const activePayload: ReleaseCommunications = {
  generated_at: '2026-11-18T06:30:00+10:00',
  cohort_id: 4,
  cohort_name: 'Prework Cohort A',
  configuration: {
    school_time_zone: 'Pacific/Guam',
    school_time_zone_label: 'ChST',
    daily_unlock_hour: 7,
    catch_up_days: 3,
    channel: 'email',
    email_configured: true,
    sender_identity: 'CSG Learn <notifications@codeschoolofguam.com>',
    sender_display_name: 'CSG Learn',
    sender_address: 'notifications@codeschoolofguam.com',
    frontend_origin: 'https://learn.codeschoolofguam.com',
    course_delivery: 'program',
    lesson_release_mode: 'scheduled_daily_unlock',
    cohort_status: 'active',
    daily_unlocks_apply: true,
    eligibility_reason: 'Active learners receive one daily email digest at 07:00 ChST when lessons unlock (up to 3 school days of catch-up).',
    grade_publication_separation_note: 'Lesson release emails announce newly unlocked lessons only. Grades and instructor feedback are published separately when an instructor saves a grade in Learn.',
  },
  recipients: {
    total_enrollments: 5,
    eligible_active_count: 2,
    excluded: {
      paused: 1,
      dropped: 1,
      completed: 0,
      expired: 0,
      invite_pending: 1,
      archived_user: 0,
      missing_email: 0,
      opted_out: 0,
      cohort_ineligible: 0,
    },
  },
  upcoming_releases: [
    {
      release_date: '2026-11-18',
      scheduled_send_at: '2026-11-18T07:00:00+10:00',
      is_today: true,
      eligible_recipient_count: 2,
      already_claimed_count: 0,
      lessons: [
        {
          id: 101,
          title: 'Variables and Strings',
          module_id: 10,
          module_name: 'Week 1 Ruby',
          lesson_type: 'exercise',
          release_day: 0,
          deep_link: 'https://learn.codeschoolofguam.com/lessons/101?cohort_id=4',
        },
      ],
    },
  ],
  sample_preview: {
    release_date: '2026-11-18',
    subject: 'New content unlocked - Code School of Guam',
    from: 'CSG Learn <notifications@codeschoolofguam.com>',
    headline: '1 new lesson unlocked!',
    intro: 'Hey Student, new content is available in Prework Cohort A:',
    lessons: [
      {
        id: 101,
        title: 'Variables and Strings',
        deep_link: 'https://learn.codeschoolofguam.com/lessons/101?cohort_id=4',
      },
    ],
    cta_label: 'Open Learn',
    cta_url: 'https://learn.codeschoolofguam.com/materials?cohort_id=4',
    footer: 'CSG Learn · Code School of Guam — Prework Cohort A',
  },
  recent_deliveries: [
    {
      date: '2026-11-18',
      key: 'daily_unlock_digest/cohort/4/2026-11-18',
      status: 'pending',
      recipient_count: 2,
      lesson_claim_count: 2,
      attempted_at: null,
      note: 'Unclaimed deliveries scheduled for 07:00 ChST.',
    },
    {
      date: '2026-11-17',
      key: 'daily_unlock_digest/cohort/4/2026-11-17',
      status: 'attempted',
      recipient_count: 2,
      lesson_claim_count: 2,
      attempted_at: '2026-11-17T07:00:12+10:00',
      note: 'Digest claim recorded for delivery; per-cohort provider delivery confirmation is not stored.',
    },
  ],
  scheduler_health: {
    scope: 'school_wide',
    task_name: 'daily_unlocks',
    status: 'error',
    last_run_at: '2026-11-18T07:00:05+10:00',
    last_succeeded_at: '2026-11-17T07:00:12+10:00',
    last_school_date: '2026-11-17',
    error_class: 'DailyUnlockNotifications::DeliveryFailed',
    note: 'School-wide daily unlock tick reported DailyUnlockNotifications::DeliveryFailed across eligible cohorts. Check server logs to determine which cohort or recipient failed.',
  },
}

describe('ReleaseCommunicationsPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('renders configuration, upcoming preview, interactive email preview, cohort claims, and separate school-wide scheduler health', async () => {
    vi.spyOn(api, 'getCohortReleaseCommunications').mockResolvedValue({
      data: { release_communications: activePayload },
      error: null,
      status: 200,
    })

    await act(async () =>
      root.render(
        <MemoryRouter>
          <ReleaseCommunicationsPanel cohortId={4} />
        </MemoryRouter>,
      ),
    )

    expect(container.textContent).toContain('Pacific/Guam (ChST)')
    expect(container.textContent).toContain('CSG Learn <notifications@codeschoolofguam.com>')
    expect(container.textContent).toContain('2 of 5 enrolled')
    expect(container.textContent).toContain('1 paused, 1 dropped, 1 invite pending')
    expect(container.textContent).toContain('Variables and Strings')
    expect(container.textContent).toContain('Grades and instructor feedback are published separately')
    expect(container.textContent).toContain('Attempted (claim recorded)')
    expect(container.textContent).toContain('Pending')
    expect(container.textContent).toContain('School-wide scheduler health')
    expect(container.textContent).toContain('DailyUnlockNotifications::DeliveryFailed')

    const previewButton = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('Preview sample email'),
    )!
    expect(container.textContent).not.toContain('New content unlocked - Code School of Guam')
    await act(async () => previewButton.click())
    expect(container.textContent).toContain('New content unlocked - Code School of Guam')
    expect(container.textContent).toContain('https://learn.codeschoolofguam.com/materials?cohort_id=4')
  })

  it('explains skipped self-paced cohorts cleanly', async () => {
    vi.spyOn(api, 'getCohortReleaseCommunications').mockResolvedValue({
      data: {
        release_communications: {
          ...activePayload,
          configuration: {
            ...activePayload.configuration,
            course_delivery: 'self_paced',
            lesson_release_mode: 'self_paced_open',
            daily_unlocks_apply: false,
            eligibility_reason: 'Self-paced cohorts open assigned lessons immediately, so scheduled daily unlock emails are skipped.',
          },
          upcoming_releases: [],
          sample_preview: null,
          recent_deliveries: [
            {
              date: '2026-11-18',
              key: 'daily_unlock_digest/cohort/4/2026-11-18',
              status: 'skipped',
              recipient_count: 0,
              lesson_claim_count: 0,
              attempted_at: '2026-11-18T07:00:00+10:00',
              note: 'Self-paced cohorts open assigned lessons immediately, so scheduled daily unlock emails are skipped.',
            },
          ],
          scheduler_health: {
            ...activePayload.scheduler_health,
            status: 'healthy',
            error_class: null,
            note: 'Last school-wide daily unlock tick completed cleanly across eligible cohorts.',
          },
        },
      },
      error: null,
      status: 200,
    })

    await act(async () =>
      root.render(
        <MemoryRouter>
          <ReleaseCommunicationsPanel cohortId={4} />
        </MemoryRouter>,
      ),
    )
    expect(container.textContent).toContain('Skipped for this cohort')
    expect(container.textContent).toContain('Self-paced cohorts open assigned lessons immediately')
    expect(container.textContent).not.toContain('Upcoming release preview')
  })

  it('shows errors and supports explicit retry', async () => {
    const spy = vi
      .spyOn(api, 'getCohortReleaseCommunications')
      .mockResolvedValueOnce({ data: null, error: 'Status unavailable', status: 503 })
      .mockResolvedValueOnce({ data: { release_communications: activePayload }, error: null, status: 200 })

    await act(async () =>
      root.render(
        <MemoryRouter>
          <ReleaseCommunicationsPanel cohortId={4} />
        </MemoryRouter>,
      ),
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Status unavailable')

    const retryButton = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent?.includes('Retry status'),
    )!
    await act(async () => retryButton.click())
    expect(spy).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Variables and Strings')
  })
})
