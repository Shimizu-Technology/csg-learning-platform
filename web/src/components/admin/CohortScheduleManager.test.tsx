// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { CohortScheduleManager } from './CohortScheduleManager'
const api = vi.hoisted(() => ({ getOfficeHours: vi.fn(), createOfficeHour: vi.fn() }))
vi.mock('../../lib/api', () => ({ api }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))
it('saves office hours description and timezone with wall-clock times', async () => {
  api.getOfficeHours.mockResolvedValue({ data: { office_hours: [] } }); api.createOfficeHour.mockResolvedValue({ data: {} })
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => root.render(<CohortScheduleManager cohortId={1} canManage canManageLearningSchedule={false} />))
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Add session')!.click())
    const set = async (name: string, value: string) => act(async () => {
      const label = [...container.querySelectorAll('label')].find(label => label.textContent?.startsWith(name))!
      const el = label.querySelector('input,textarea')!
      Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await set('Title', 'Practice help'); await set('Starts', '2026-12-01T10:00'); await set('Ends', '2026-12-01T11:00')
    await set('Description', 'Bring your exercises'); await set('Timezone', 'Asia/Tokyo')
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(api.createOfficeHour).toHaveBeenCalledWith(1, expect.objectContaining({ description: 'Bring your exercises', timezone: 'Asia/Tokyo', starts_at: '2026-12-01T10:00', ends_at: '2026-12-01T11:00' }))
  } finally { act(() => root.unmount()); container.remove() }
})
