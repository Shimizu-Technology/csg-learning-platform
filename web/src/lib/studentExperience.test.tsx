// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ cohort: {} as Record<string, unknown>, auth: {} as Record<string, unknown> }))
vi.mock('../contexts/CohortContext', () => ({ useCohortContext: () => state.cohort }))
vi.mock('../contexts/AuthContext', () => ({ useAuthContext: () => state.auth }))

import { StudentExperienceProvider, studentExperienceOn, useStudentExperience } from './studentExperience'

let container: HTMLDivElement
let root: Root
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })

function Probe() {
  const { ready, v2 } = useStudentExperience()
  return <p>{ready ? (v2 ? 'v2' : 'v1') : 'waiting'}</p>
}
const cohort = (features: Record<string, boolean>) => ({ id: 3, features, capabilities: { features } })
const render = (node = <Probe />) => act(() => root.render(node))

it('reads the selected cohort switch and waits for the cohort list', () => {
  state.auth = { schoolFeatures: { student_experience_v2: true } }
  state.cohort = { ready: false, selectedCohort: null, error: null }
  render()
  expect(container.textContent).toBe('waiting')
  state.cohort = { ready: true, selectedCohort: cohort({ student_experience_v2: false }), error: null }
  render()
  expect(container.textContent).toBe('v1')
  state.cohort = { ready: true, selectedCohort: cohort({}), error: null }
  render()
  expect(container.textContent).toBe('v2')
})

it('keeps the decided view through a failed refresh, and is safe when nothing was decided', () => {
  state.auth = {}
  state.cohort = { ready: true, selectedCohort: null, error: 'Could not load your cohorts.' }
  render()
  expect(container.textContent).toBe('v1')
  act(() => root.unmount())
  root = createRoot(container)
  state.cohort = { ready: true, selectedCohort: cohort({ student_experience_v2: true }), error: null }
  render()
  expect(container.textContent).toBe('v2')
  state.cohort = { ready: true, selectedCohort: null, error: 'Could not load your cohorts.' }
  render()
  expect(container.textContent).toBe('v2')
})

it('a staff preview shows the previewed cohort, not the viewer', () => {
  state.cohort = { ready: false, selectedCohort: null, error: null }
  render(<StudentExperienceProvider v2={false}><Probe /></StudentExperienceProvider>)
  expect(container.textContent).toBe('v1')
  expect(studentExperienceOn(undefined)).toBe(true)
  expect(studentExperienceOn({ student_experience_v2: false })).toBe(false)
})
