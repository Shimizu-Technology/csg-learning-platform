// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { ConversationHeader } from './ConversationHeader'

it.each([
  ['/admin?cohort_id=4&kind=message', 'Back to Today'],
  ['/admin/moderation', 'Back to Safety'],
  ['/admin/support?cohort_id=4', 'Back to Support'],
  ['/unknown', 'Back'],
])('labels the actual return destination %s', (returnTo, label) => {
  const container = document.createElement('div'); const root = createRoot(container)
  const props = {
    selectedTarget: { type: 'dm', id: 2 }, selected: { workspace_name: 'School' },
    route: { navigate: vi.fn() },
    conversation: { isDesktop: true, sidebarCollapsed: false, selectedPinnedMessages: [] },
    directory: { isStaff: true, selectedLabel: 'Alex', toggleMute: vi.fn() },
    alerts: {}, conversationReturnContext: vi.fn(), copyConversationLink: vi.fn(), setAuthorContext: vi.fn(), showPushMessage: false,
  } as unknown as Parameters<typeof ConversationHeader>[0]
  act(() => root.render(<MemoryRouter initialEntries={[`/messages/dm/2?return_to=${encodeURIComponent(returnTo)}`]}><ConversationHeader {...props} /></MemoryRouter>))
  const link = container.querySelector('header > a')
  expect(link?.textContent).toBe(label)
  expect(link?.getAttribute('href')).toBe(returnTo)
  act(() => root.unmount())
})
