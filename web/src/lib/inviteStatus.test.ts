import { describe, expect, it } from 'vitest'
import { inviteStatusPresentation, resolveInviteState } from './inviteStatus'

const now = new Date('2026-10-20T00:00:00Z')

describe('resolveInviteState', () => {
  it('prefers the API state', () => {
    expect(resolveInviteState({ invite_pending: true, invite_delivery_status: 'sent', invite_state: 'expired' }, now)).toBe('expired')
  })

  it('derives the same states when an older API omits invite_state', () => {
    expect(resolveInviteState({ invite_pending: false, invite_delivery_status: 'accepted' }, now)).toBe('accepted')
    expect(resolveInviteState({ invite_pending: true, invite_delivery_status: 'failed' }, now)).toBe('failed')
    expect(resolveInviteState({ invite_pending: true, invite_delivery_status: 'sent', invite_sent_at: '2026-10-10T00:00:00Z' }, now)).toBe('sent')
    expect(resolveInviteState({ invite_pending: true, invite_delivery_status: 'sent', invite_sent_at: '2026-09-15T00:00:00Z' }, now)).toBe('expired')
    expect(resolveInviteState({ invite_pending: true, invite_delivery_status: null }, now)).toBe('not_sent')
  })
})

describe('inviteStatusPresentation', () => {
  it('maps every state to one badge tone, label and resend action', () => {
    const cases = [
      [{ invite_pending: false, invite_state: 'accepted' as const }, 'success', 'Accepted', null],
      [{ invite_pending: true, invite_state: 'sent' as const, invite_sent_at: '2026-10-18T00:00:00Z', invite_expires_at: '2026-11-17T00:00:00Z' }, 'pending', 'Invite sent', 'Resend'],
      [{ invite_pending: true, invite_state: 'failed' as const, invite_last_error: 'Invite email delivery failed' }, 'danger', 'Invite failed', 'Retry invite'],
      [{ invite_pending: true, invite_state: 'expired' as const, invite_sent_at: '2026-09-01T00:00:00Z' }, 'warning', 'Invite expired', 'Send new invite'],
      [{ invite_pending: true, invite_state: 'queued' as const }, 'pending', 'Sending invite', 'Resend'],
      [{ invite_pending: true, invite_state: 'not_sent' as const }, 'neutral', 'Invite not sent', 'Send invite'],
    ] as const
    for (const [member, tone, label, action] of cases) {
      const presentation = inviteStatusPresentation(member, now)
      expect(presentation.tone).toBe(tone)
      expect(presentation.label).toBe(label)
      expect(presentation.actionLabel).toBe(action)
    }
  })

  it('explains dates in Guam time and the failure reason', () => {
    expect(inviteStatusPresentation({ invite_pending: true, invite_state: 'sent', invite_sent_at: '2026-10-18T00:00:00Z', invite_expires_at: '2026-11-17T00:00:00Z' }, now).detail).toBe('Sent Oct 18, 2026 · link works until Nov 17, 2026')
    expect(inviteStatusPresentation({ invite_pending: true, invite_state: 'failed', invite_last_error: 'Invite email delivery failed' }, now).detail).toBe('Not delivered: Invite email delivery failed')
    expect(inviteStatusPresentation({ invite_pending: true, invite_state: 'expired', invite_sent_at: '2026-09-01T00:00:00Z' }, now).detail).toBe('The link expired Oct 1, 2026. Send a new one.')
  })
})
