import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { InvitationHelp } from './InvitationHelp'

describe('InvitationHelp', () => {
  it('points to the email link, a new invitation, and sign-in instead of a dead end', () => {
    const html = renderToStaticMarkup(<MemoryRouter><InvitationHelp /></MemoryRouter>)
    expect(html).toContain('Use the link in your invitation email')
    expect(html).toContain('Accept invitation')
    expect(html).toContain('href="mailto:codeschoolofguam@gmail.com?subject=CSG%20Learn%20invitation"')
    expect(html).toContain('href="/sign-in"')
  })
})
