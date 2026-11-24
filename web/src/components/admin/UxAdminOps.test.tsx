// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'

vi.mock('../../contexts/AuthContext', () => ({
  useAuthContext: () => ({
    user: { id: 1, full_name: 'Admin User', role: 'admin', is_staff: true, is_admin: true },
    isSignedIn: true,
    isLoading: false,
    enrollments: [],
  }),
}))
import { CohortSetupChecklist } from './CohortSetupChecklist'
import type { CohortDetail } from '../../types/api'
import { FEATURE_SWITCH_META, FeatureSettings, resolveEffectiveSwitchState } from './FeatureSettings'
import { GithubSyncHealthPanel } from './GithubSyncHealthPanel'
import { SchoolIdentityPreview } from './SchoolIdentityPreview'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })

describe('UX Wave D admin ops components', () => {
  it('defines plain-English labels and descriptions for all 19 feature switches and computes effective badges', () => {
    expect(Object.keys(FEATURE_SWITCH_META)).toHaveLength(19)
    for (const [key, meta] of Object.entries(FEATURE_SWITCH_META)) {
      expect(meta.label.length).toBeGreaterThan(2)
      expect(meta.label).not.toContain('_')
      expect(meta.description.length).toBeGreaterThan(20)
      expect(key.length).toBeGreaterThan(0)
    }

    expect(resolveEffectiveSwitchState({ key: 'github_app', cohortId: 1, value: true, schoolDefault: false }))
      .toMatchObject({ label: 'Needs school switch', effectiveOn: false })
    expect(resolveEffectiveSwitchState({ key: 'github_app', cohortId: 1, value: null, schoolDefault: true }))
      .toMatchObject({ label: 'Off', extraBadge: { label: 'Cohort opt-in' }, effectiveOn: false })
    expect(resolveEffectiveSwitchState({ key: 'recordings', cohortId: 1, value: null, schoolDefault: true }))
      .toMatchObject({ label: 'On', effectiveOn: true })
  })

  it('renders FeatureSettings with effective badges and View changes link', async () => {
    vi.spyOn(api, 'getFeatureSettings').mockResolvedValue({
      data: {
        features: { recordings: true, github_app: false },
        defaults: { recordings: true, github_app: false },
        overrides: { github_app: true },
        cohort: { id: 9, name: 'Cohort 9' },
        public_catalog_mode: 'automatic',
        review_response_time: 'usually reviewed within 2 business days',
      },
      error: null,
    })

    await act(async () => {
      root.render(
        <MemoryRouter>
          <FeatureSettings cohortId={9} />
        </MemoryRouter>,
      )
    })
    await flush()

    expect(container.textContent).toContain('Needs school switch')
    expect(container.textContent).toContain('View changes')
    expect(container.querySelector('a[href="/admin/settings?tab=changes&cohort_id=9"]')).not.toBeNull()
  })

  it('renders GithubSyncHealthPanel with plain-English learner reasons and student links', async () => {
    vi.spyOn(api, 'getCohortGithubSyncHealth').mockResolvedValue({
      data: {
        cohort_id: 5,
        app_configured: true,
        oauth_configured: true,
        school_github_app_enabled: true,
        cohort_github_app_enabled: true,
        github_sync_enabled: true,
        webhooks_enabled: true,
        reconciliation_enabled: true,
        grade_suggestions_enabled: false,
        installations: [
          {
            id: 1,
            cohort_id: 5,
            app_id: 1001,
            installation_id: 9001,
            account_id: 5001,
            account_login: 'school-org',
            account_type: 'Organization',
            repository_selection: 'selected',
            permissions: { contents: 'read' },
            connection_state: 'connected',
            failure_reason: null,
            connected_at: '2026-11-20T00:00:00Z',
            checked_at: '2026-11-24T00:00:00Z',
          },
        ],
        github_modules: [{ id: 12, name: 'Prework', repository_name: 'prework' }],
        summary: {
          total_learners: 2,
          healthy_count: 1,
          sync_error_count: 1,
          unverified_count: 0,
          not_bound_count: 0,
          identity_missing_count: 0,
          app_not_ready_count: 0,
        },
        learners: [
          {
            enrollment_id: 101,
            user_id: 201,
            full_name: 'Maya Lin',
            email: 'maya@example.com',
            github_username: 'mayalin',
            identity_verified: true,
            github_verified_login: 'mayalin',
            github_verified_at: '2026-11-20T00:00:00Z',
            status: 'sync_error',
            plain_reason: 'The linked GitHub repository could not be found.',
            last_synced_at: '2026-11-24T08:00:00Z',
            next_retry_at: '2026-11-24T09:00:00Z',
            last_error: '404 Not Found',
            bindings: [
              {
                id: 301,
                enrollment_id: 101,
                curriculum_module_id: 12,
                module_name: 'Prework',
                full_name: 'mayalin/prework',
                verification_state: 'verified',
                failure_reason: null,
                verified_at: '2026-11-20T00:00:00Z',
                last_reconciled_at: '2026-11-24T08:00:00Z',
                last_status: 'failed',
                last_error: '404 Not Found',
                next_reconcile_at: '2026-11-24T09:00:00Z',
              },
            ],
          },
        ],
      },
      error: null,
    })

    await act(async () => {
      root.render(
        <MemoryRouter>
          <GithubSyncHealthPanel cohortId={5} />
        </MemoryRouter>,
      )
    })
    await flush()

    expect(container.textContent).toContain('GitHub sync health')
    expect(container.textContent).toContain('Maya Lin')
    expect(container.textContent).toContain('The linked GitHub repository could not be found.')
    expect(container.querySelector('a[href*="/students/201"]')).not.toBeNull()
  })

  it('renders CohortSetupChecklist for program, guided, and self-paced delivery modes', async () => {
    const baseCohort = {
      id: 4,
      name: 'Spring Cohort',
      status: 'active',
      start_date: '2026-12-01',
      end_date: '2027-03-01',
      course_delivery: 'guided' as const,
      enrolled_count: 3,
      active_count: 3,
      seat_limit: 20,
      seats_taken: 3,
      public_checkout_enabled: true,
      support_instructor_id: 7,
      offering_readiness: {
        curriculum_assigned: true,
        price_set: true,
        price_verified: false,
        support_instructor_set: true,
        published_content: true,
        cohort_active: true,
      },
      modules: [{ id: 1, name: 'Week 1', unlocked: true, effective_unlock_date: '2026-12-01' }],
      students: [],
    }

    await act(async () => {
      root.render(
        <MemoryRouter>
          <CohortSetupChecklist cohort={baseCohort as unknown as CohortDetail} />
        </MemoryRouter>,
      )
    })

    expect(container.textContent).toContain('Setup checklist')
    expect(container.textContent).toContain('Small class')
    expect(container.textContent).toContain('Dates and first release')
    expect(container.textContent).toContain('Seats and enrollment')
    expect(container.textContent).toContain('Checkout and verified Stripe price')
  })

  it('renders read-only SchoolIdentityPreview from API response', async () => {
    vi.spyOn(api, 'getSchoolIdentity').mockResolvedValue({
      data: {
        school_identity: {
          name: 'Pacific Dev Academy',
          product_name: 'Pacific Learn',
          abbreviation: 'PDA',
          short_name: 'Pacific Dev',
          support_email: 'help@pacific.example',
          email_sender: 'Pacific Dev <help@pacific.example>',
          sender_name_override: 'Pacific Dev',
          time_zone: 'Pacific/Guam',
          time_zone_label: 'Guam (ChST, UTC+10)',
          site_url: 'https://pacific.example/',
          app_url: 'https://learn.pacific.example',
          frontend_origin: 'https://learn.pacific.example',
        },
      },
      error: null,
    })

    await act(async () => {
      root.render(
        <MemoryRouter>
          <SchoolIdentityPreview />
        </MemoryRouter>,
      )
    })
    await flush()

    expect(container.textContent).toContain('Pacific Dev Academy')
    expect(container.textContent).toContain('help@pacific.example')
    expect(container.textContent).toContain('Guam (ChST, UTC+10)')
  })
})
