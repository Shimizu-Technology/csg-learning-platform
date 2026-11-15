// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ updateCurriculum: vi.fn(), updateModule: vi.fn(), deleteModule: vi.fn(), success: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: mocks.success }) }))
vi.mock('../../components/shared/Modal', () => ({ Modal: ({ children, title }: { children: React.ReactNode; title: string }) => <div role="dialog" aria-label={title}>{children}</div> }))
import { CurriculumStatusActions, ModuleActions, StructureEditor } from './StructureActions'
let host: HTMLDivElement
let root: Root
const saved = vi.fn().mockResolvedValue(undefined)
const record = { id: 1, name: 'Synthetic curriculum', description: 'Before', updated_at: '2026-11-16' }
beforeEach(() => { vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const button = (text: string) => Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes(text))!
it('edits curriculum name and description with its version and retains failed drafts', async () => {
  mocks.updateCurriculum.mockResolvedValue({ error: 'Changed by another editor' })
  await act(async () => root.render(<StructureEditor kind="curriculum" record={record} onSaved={saved} />))
  await act(async () => button('Edit curriculum').click())
  const input = document.querySelector('input')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Renamed'); input.dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(mocks.updateCurriculum).toHaveBeenCalledWith(1, { name: 'Renamed', description: 'Before', base_updated_at: record.updated_at })
  expect(document.body.textContent).toContain('Changed by another editor')
  expect(saved).not.toHaveBeenCalled()
  mocks.updateCurriculum.mockResolvedValue({ data: {} })
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(saved).toHaveBeenCalled()
})
it('explains publication before writing and shows archive blockers', async () => {
  mocks.updateCurriculum.mockResolvedValue({ data: {} })
  await act(async () => root.render(<CurriculumStatusActions curriculum={{ ...record, status: 'draft', archive_blocked: true }} onSaved={saved} />))
  await act(async () => button('Publish').click())
  expect(document.body.textContent).toContain('available for purchases')
  expect(mocks.updateCurriculum).not.toHaveBeenCalled()
  await act(async () => button('Confirm publish').click())
  expect(mocks.updateCurriculum).toHaveBeenCalledWith(1, { status: 'active', base_updated_at: record.updated_at })
  await act(async () => button('Archive').click())
  expect(document.body.textContent).toContain('Archive blocked')
  expect(button('Confirm archive').disabled).toBe(true)
})
it('moves with keyboard controls and prevents deleting learner submissions', async () => {
  const move = vi.fn()
  await act(async () => root.render(<ModuleActions mod={{ ...record, lessons: [{}], submissions_count: 3, deletion_blocked: true }} index={0} count={2} busy={false} onMove={move} onSaved={saved} />))
  const down = host.querySelector<HTMLButtonElement>('button[aria-label="Move Synthetic curriculum down"]')!
  await act(async () => down.click())
  expect(move).toHaveBeenCalledWith(0, 1)
  await act(async () => button('Delete module').click())
  expect(document.body.textContent).toContain('This module has student work.')
  expect(button('Delete permanently').disabled).toBe(true)
  expect(mocks.deleteModule).not.toHaveBeenCalled()
})
it('preserves the delete confirmation on API failure', async () => {
  mocks.deleteModule.mockResolvedValue({ error: 'New learner data prevents deletion' })
  await act(async () => root.render(<ModuleActions mod={{ ...record, lessons: [] }} index={0} count={1} busy={false} onMove={vi.fn()} onSaved={saved} />))
  await act(async () => button('Delete module').click())
  await act(async () => button('Delete permanently').click())
  expect(document.body.textContent).toContain('New learner data prevents deletion')
  expect(saved).not.toHaveBeenCalled()
})

it('requires a second explicit confirmation naming affected live offerings', async () => {
  mocks.updateCurriculum.mockResolvedValue({ data: {} })
  await act(async () => root.render(<CurriculumStatusActions curriculum={{ ...record, status: 'active', live_checkout_offerings: [{ id: 8, name: 'Python self-paced' }] }} onSaved={saved} />))
  await act(async () => button('Unpublish').click())
  expect(document.body.textContent).toContain('This stops new purchases for: Python self-paced')
  expect(button('Confirm unpublish').disabled).toBe(true)
  await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
  await act(async () => button('Confirm unpublish').click())
  expect(mocks.updateCurriculum).toHaveBeenCalledWith(1, { status: 'draft', base_updated_at: record.updated_at })
})
it('keeps the focused move control focusable while busy and ignores repeated activation', async () => {
  const move = vi.fn()
  const props = { mod: { ...record, lessons: [] }, index: 0, count: 2, onMove: move, onSaved: saved }
  await act(async () => root.render(<ModuleActions {...props} busy={false} />))
  const down = host.querySelector<HTMLButtonElement>('button[data-direction="down"]')!
  down.focus()
  await act(async () => root.render(<ModuleActions {...props} busy />))
  expect(document.activeElement).toBe(down)
  await act(async () => down.click())
  expect(move).not.toHaveBeenCalled()
})
it('offers Archived to Draft and pluralizes an empty module delete summary', async () => {
  await act(async () => root.render(<CurriculumStatusActions curriculum={{ ...record, status: 'archived' }} onSaved={saved} />))
  await act(async () => button('Move to draft').click())
  expect(button('Confirm unpublish')).toBeTruthy()
  await act(async () => root.render(<ModuleActions mod={{ ...record, lessons: [{}], submissions_count: 1 }} index={0} count={1} busy={false} onMove={vi.fn()} onSaved={saved} />))
  await act(async () => button('Delete module').click())
  expect(document.body.textContent).toContain('1 lesson (including archived lessons) and 1 submission.')
})

it('lets the studio rename a module inline without opening a dialog', async () => {
  mocks.updateModule.mockResolvedValue({ data: {} })
  await act(async () => root.render(<StructureEditor inline kind="module" record={record} onSaved={saved} />))
  await act(async () => button('Edit module').click())
  expect(host.querySelector('section[aria-label="Edit module"]')).not.toBeNull()
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(mocks.updateModule).toHaveBeenCalledWith(1, { name: record.name, description: record.description, base_updated_at: record.updated_at })
})
