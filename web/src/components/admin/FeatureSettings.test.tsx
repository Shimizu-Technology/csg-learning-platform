// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { FeatureSettings } from './FeatureSettings'
const api = vi.hoisted(() => ({ getFeatureSettings: vi.fn(), saveFeatureSettings: vi.fn() }))
vi.mock('../../lib/api', () => ({ api }))
let root: Root, container: HTMLDivElement
const data = { features: { recordings: true }, defaults: { recordings: true }, overrides: {}, public_catalog_mode: 'automatic' }
beforeEach(() => {
  api.getFeatureSettings.mockResolvedValue({ data }); api.saveFeatureSettings.mockResolvedValue({ data })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks() })
it('saves school changes including public catalog preference', async () => {
  await act(async () => root.render(<FeatureSettings />))
  const select = container.querySelectorAll('select')[2]
  await act(async () => { select.value = 'off'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => container.querySelector('button')!.click())
  expect(api.saveFeatureSettings).toHaveBeenCalledWith({ features: { recordings: false }, public_catalog_mode: 'automatic' }, undefined)
  expect(container.textContent).toContain('Features saved')
})
it('shows inherited values and persists explicit cohort overrides', async () => {
  await act(async () => root.render(<FeatureSettings cohortId={12} />))
  expect(container.textContent).toContain('Inherit → On')
  const select = container.querySelectorAll('select')[2]
  await act(async () => { select.value = 'off'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => container.querySelector('button')!.click())
  expect(api.saveFeatureSettings).toHaveBeenCalledWith({ features: { recordings: false } }, 12)
})

it('drops removed overrides before saving', async () => {
  api.getFeatureSettings.mockResolvedValue({ data: { ...data, overrides: { course_community: false, recordings: false } } })
  await act(async () => root.render(<FeatureSettings cohortId={12} />))
  await act(async () => container.querySelector('button')!.click())
  expect(api.saveFeatureSettings).toHaveBeenCalledWith({ features: { recordings: false } }, 12)
})

it('shows resolved Off inheritance and saves inherit without turning it on', async () => {
  api.getFeatureSettings.mockResolvedValue({ data: { ...data, features: { recordings: true }, defaults: { recordings: false }, overrides: { recordings: true } } })
  await act(async () => root.render(<FeatureSettings cohortId={12} />))
  const select = container.querySelectorAll('select')[2]
  expect(select.textContent).toContain('Inherit → Off')
  expect(select.value).toBe('on')
  await act(async () => { select.value = 'inherit'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => container.querySelector('button')!.click())
  expect(api.saveFeatureSettings).toHaveBeenCalledWith({ features: { recordings: null } }, 12)
})

it('keeps App inheritance Off even when the school switch is On and requires an explicit cohort choice', async () => {
  api.getFeatureSettings.mockResolvedValue({ data: { ...data, features: { github_app: false }, defaults: { github_app: true }, overrides: {} } })
  await act(async () => root.render(<FeatureSettings cohortId={12} />))
  const label = [...container.querySelectorAll('label')].find(item => item.textContent?.startsWith('GitHub App access'))!
  const select = label.querySelector('select')!
  expect(select.value).toBe('inherit')
  expect(select.selectedOptions[0].textContent).toBe('Inherit → Off')
  await act(async () => container.querySelector('button')!.click())
  expect(api.saveFeatureSettings).toHaveBeenLastCalledWith({ features: {} }, 12)
  await act(async () => { select.value = 'on'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => container.querySelector('button')!.click())
  expect(api.saveFeatureSettings).toHaveBeenLastCalledWith({ features: { github_app: true } }, 12)
})

it('keeps Course community (self-paced) inheritance Off even when school default is On and shows recommendation copy', async () => {
  api.getFeatureSettings.mockResolvedValue({ data: { ...data, features: { self_paced_peer_space: false }, defaults: { self_paced_peer_space: true }, overrides: {} } })
  await act(async () => root.render(<FeatureSettings cohortId={12} />))
  const label = [...container.querySelectorAll('label')].find(item => item.textContent?.startsWith('Course community (self-paced)'))!
  expect(label.textContent).toContain('Lets self-paced learners talk in class chat. Recommended when 5 or more learners are enrolled.')
  const select = label.querySelector('select')!
  expect(select.value).toBe('inherit')
  expect(select.selectedOptions[0].textContent).toBe('Inherit → Off')
  await act(async () => container.querySelector('button')!.click())
  expect(api.saveFeatureSettings).toHaveBeenLastCalledWith({ features: {} }, 12)
  await act(async () => { select.value = 'on'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => container.querySelector('button')!.click())
  expect(api.saveFeatureSettings).toHaveBeenLastCalledWith({ features: { self_paced_peer_space: true } }, 12)
})

it('keeps learner reminders Off by inheritance even when the school switch is On', async () => {
  api.getFeatureSettings.mockResolvedValue({ data: { ...data, features: { learner_nudges: false }, defaults: { learner_nudges: true }, overrides: {} } })
  await act(async () => root.render(<FeatureSettings cohortId={12} />))
  const label = [...container.querySelectorAll('label')].find(item => item.textContent?.startsWith('Learner reminders'))!
  const select = label.querySelector('select')!
  expect(select.selectedOptions[0].textContent).toBe('Inherit → Off')
  await act(async () => { select.value = 'on'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => container.querySelector('button')!.click())
  expect(api.saveFeatureSettings).toHaveBeenLastCalledWith({ features: { learner_nudges: true } }, 12)
})

it('keeps GitHub webhooks Off by inheritance even when the school switch is On', async () => {
  api.getFeatureSettings.mockResolvedValue({ data: { ...data, features: { github_webhooks: false }, defaults: { github_webhooks: true }, overrides: {} } })
  await act(async () => root.render(<FeatureSettings cohortId={12} />))
  const label = [...container.querySelectorAll('label')].find(item => item.textContent?.startsWith('GitHub webhooks'))!
  const select = label.querySelector('select')!
  expect(select.value).toBe('inherit')
  expect(select.selectedOptions[0].textContent).toBe('Inherit → Off')
  await act(async () => { select.value = 'on'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => container.querySelector('button')!.click())
  expect(api.saveFeatureSettings).toHaveBeenLastCalledWith({ features: { github_webhooks: true } }, 12)
})

it('keeps Reliable GitHub Redo issues Off by inheritance even when the school switch is On', async () => {
  api.getFeatureSettings.mockResolvedValue({ data: { ...data, features: { github_issue_delivery_v2: false }, defaults: { github_issue_delivery_v2: true }, overrides: {} } })
  await act(async () => root.render(<FeatureSettings cohortId={12} />))
  const label = [...container.querySelectorAll('label')].find(item => item.textContent?.startsWith('Reliable GitHub Redo issues'))!
  const select = label.querySelector('select')!
  expect(select.value).toBe('inherit')
  expect(select.selectedOptions[0].textContent).toBe('Inherit → Off')
  await act(async () => container.querySelector('button')!.click())
  expect(api.saveFeatureSettings).toHaveBeenLastCalledWith({ features: {} }, 12)
  await act(async () => { select.value = 'on'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => container.querySelector('button')!.click())
  expect(api.saveFeatureSettings).toHaveBeenLastCalledWith({ features: { github_issue_delivery_v2: true } }, 12)
})

it('keeps GitHub grade suggestions Off by inheritance even when the school switch is On', async () => {
  api.getFeatureSettings.mockResolvedValue({ data: { ...data, features: { github_grade_suggestions: false }, defaults: { github_grade_suggestions: true }, overrides: {} } })
  await act(async () => root.render(<FeatureSettings cohortId={12} />))
  const label = [...container.querySelectorAll('label')].find(item => item.textContent?.startsWith('GitHub grade suggestions'))!
  const select = label.querySelector('select')!
  expect(select.value).toBe('inherit')
  expect(select.selectedOptions[0].textContent).toBe('Inherit → Off')
  await act(async () => container.querySelector('button')!.click())
  expect(api.saveFeatureSettings).toHaveBeenLastCalledWith({ features: {} }, 12)
  await act(async () => { select.value = 'on'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => container.querySelector('button')!.click())
  expect(api.saveFeatureSettings).toHaveBeenLastCalledWith({ features: { github_grade_suggestions: true } }, 12)
})
