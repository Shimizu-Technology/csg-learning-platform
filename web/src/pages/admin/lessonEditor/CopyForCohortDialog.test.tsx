// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../lib/api'
import type { CurriculumCopyPreview, CurriculumCopyPreviewResponse } from '../../../types/api'
import { CopyForCohortDialog } from './CopyForCohortDialog'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type PreviewAnswer = { data: CurriculumCopyPreviewResponse | null; error: string | null }

function previewFor(cohortId: number, curriculumId: number, overrides: Partial<CurriculumCopyPreview> = {}): PreviewAnswer {
  return { error: null, data: { curriculum_copy_preview: {
    cohort: { id: cohortId, name: `Cohort ${cohortId}` }, source_curriculum: { id: curriculumId, name: `Lab ${curriculumId}` }, copy_name: `Lab ${curriculumId} (Cohort ${cohortId})`,
    shared_with: [{ id: 99, name: 'Cohort 99' }], already_copied: false, copy_curriculum_id: null, can_copy: true, blockers: [], counts: { lessons: 2 },
    ...overrides,
  } } }
}

const cohorts = [{ id: 3, name: 'Cohort 3' }, { id: 4, name: 'Cohort 4' }]
let root: Root
let container: HTMLDivElement
let pending: Array<{ cohortId: number; curriculumId: number; resolve: (answer: PreviewAnswer) => void }>

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  pending = []
  vi.spyOn(api, 'getCurriculumCopyPreview').mockImplementation((cohortId: number, curriculumId: number) => new Promise((resolve) => {
    pending.push({ cohortId, curriculumId, resolve: resolve as (answer: PreviewAnswer) => void })
  }) as never)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.querySelectorAll('[data-state="closing"]').forEach((ghost) => ghost.dispatchEvent(new Event('animationend', { bubbles: true })))
  container.remove()
  vi.restoreAllMocks()
})

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
const confirmButton = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((item) => /^(Make a copy|Open the copy)$/.test(item.textContent || ''))!
const dialogText = () => document.querySelector('[role="dialog"]')?.textContent || ''
async function show(props: { open?: boolean; curriculumId?: number } = {}) {
  await act(async () => root.render(<CopyForCohortDialog open={props.open ?? true} onClose={() => undefined} curriculumId={props.curriculumId ?? 1} cohorts={cohorts} onCopied={() => undefined} />))
  await settle()
}
async function answer(index: number, value: PreviewAnswer) {
  await act(async () => pending[index].resolve(value))
  await settle()
}

describe('Make a copy dialog', () => {
  it('starts each check from nothing when the dialog opens again, and enables the copy only once the new check answers', async () => {
    await show()
    await answer(0, previewFor(3, 1))
    expect(confirmButton().disabled).toBe(false)

    await show({ open: false })
    await show()
    expect(pending).toHaveLength(2)
    expect(confirmButton().disabled).toBe(true)
    expect(dialogText()).toContain('Checking what moves with Cohort 3')

    // This time the cohort can't be copied any more.
    await answer(1, previewFor(3, 1, { can_copy: false, blockers: [{ code: 'copied_before', message: 'Cohort 3 already has a copy.' }] }))
    expect(confirmButton().disabled).toBe(true)
    expect(dialogText()).toContain('Cohort 3 already has a copy.')
  })

  it('never lets an answer for another curriculum enable the copy', async () => {
    await show({ curriculumId: 1 })
    await answer(0, previewFor(3, 1))
    expect(confirmButton().disabled).toBe(false)

    await show({ curriculumId: 2 })
    expect(pending.map((request) => [request.cohortId, request.curriculumId])).toEqual([[3, 1], [3, 2]])
    expect(confirmButton().disabled).toBe(true)
    await answer(1, previewFor(3, 2))
    expect(confirmButton().disabled).toBe(false)
    expect(dialogText()).toContain('own copy of Lab 2')
  })

  it("keeps the copy disabled when the new check fails, even after an earlier one passed", async () => {
    await show()
    await answer(0, previewFor(3, 1))
    await show({ open: false })
    await show()
    await answer(1, { data: null, error: 'The copy couldn\'t be checked.' })

    expect(confirmButton().disabled).toBe(true)
    expect(dialogText()).toContain('The copy couldn\'t be checked.')
  })

  it('ignores a late answer for a cohort no longer chosen', async () => {
    await show()
    const select = document.querySelector<HTMLSelectElement>('[role="dialog"] select')!
    await act(async () => { select.value = '4'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    await settle()
    await answer(0, previewFor(3, 1))
    expect(confirmButton().disabled).toBe(true)
    expect(dialogText()).toContain('Checking what moves with Cohort 4')

    await answer(1, previewFor(4, 1))
    expect(confirmButton().disabled).toBe(false)
  })
})
