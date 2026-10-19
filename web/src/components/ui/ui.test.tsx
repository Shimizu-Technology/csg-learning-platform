import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { Avatar, initialsFor } from './Avatar'
import { Badge, BADGE_TONES, type BadgeTone } from './Badge'
import { AnchorButton, Button, BUTTON_SIZES, BUTTON_VARIANTS, IconButton, LinkButton, buttonClasses, type ButtonVariant } from './Button'

describe('Button', () => {
  it.each(Object.keys(BUTTON_VARIANTS) as ButtonVariant[])('renders the %s variant from role tokens', (variant) => {
    const html = renderToStaticMarkup(<Button variant={variant}>Save</Button>)
    expect(html).toContain(`data-variant="${variant}"`)
    expect(html).toContain('type="button"')
    expect(html).toContain('active:scale-[0.97]')
    // No raw Tailwind red: danger uses the danger role, brand uses ruby tokens.
    expect(html).not.toMatch(/\b(bg|text|border)-red-\d/)
    expect(html).not.toMatch(/\b(bg|text|border)-primary-\d/)
  })

  it('uses the action-primary token and darkens on hover and press', () => {
    const primary = BUTTON_VARIANTS.primary
    expect(primary).toContain('bg-action-primary ')
    expect(primary).toContain('hover:bg-action-primary-hover')
    expect(primary).toContain('active:bg-action-primary-pressed')
  })

  it('keeps 44px (md) and 48px (lg) targets; sm is 36px only at the desktop breakpoint', () => {
    expect(BUTTON_SIZES.md).toContain('min-h-11')
    expect(BUTTON_SIZES.lg).toContain('min-h-12')
    expect(BUTTON_SIZES.sm).toContain('min-h-11')
    expect(BUTTON_SIZES.sm).toContain('lg:min-h-9')
  })

  it('names the transitioned properties instead of transition-all', () => {
    expect(buttonClasses()).not.toMatch(/transition-all|\btransition\b(?!-)/)
    expect(buttonClasses()).toContain('transition-[background-color,border-color,color,box-shadow,scale]')
  })

  it('does not hide the global focus ring', () => {
    expect(buttonClasses()).not.toContain('outline-none')
  })

  it('renders router and external links with the same classes', () => {
    const link = renderToStaticMarkup(<MemoryRouter><LinkButton to="/lessons/1" variant="secondary">Open</LinkButton></MemoryRouter>)
    expect(link).toContain('href="/lessons/1"')
    expect(link).toContain('data-variant="secondary"')
    const anchor = renderToStaticMarkup(<AnchorButton href="https://example.com">Join</AnchorButton>)
    expect(anchor).toContain('data-variant="secondary"')
  })

  it('gives icon buttons an accessible name and a 44px target', () => {
    const html = renderToStaticMarkup(<IconButton label="Close">x</IconButton>)
    expect(html).toContain('aria-label="Close"')
    expect(html).toContain('h-11 w-11')
  })
})

describe('Badge', () => {
  it.each(Object.keys(BADGE_TONES) as BadgeTone[])('renders the %s tone at 12px/600', (tone) => {
    const html = renderToStaticMarkup(<Badge tone={tone}>Awaiting review</Badge>)
    expect(html).toContain(`data-tone="${tone}"`)
    expect(html).toContain('text-xs')
    expect(html).toContain('font-semibold')
    expect(html).not.toContain('uppercase')
    expect(html).toContain('Awaiting review')
  })

  it('only uses red for the danger tone', () => {
    for (const [tone, classes] of Object.entries(BADGE_TONES)) {
      if (tone === 'danger') expect(classes).toContain('danger-')
      else expect(classes).not.toContain('danger-')
    }
  })
})

describe('Avatar', () => {
  it('derives up to two initials', () => {
    expect(initialsFor('Maria Santos')).toBe('MS')
    expect(initialsFor('Bartholomew Fitzgerald-Montgomery Worthington III')).toBe('BI')
    expect(initialsFor('王秀英')).toBe('王')
    expect(initialsFor('')).toBe('?')
  })

  it('shows initials on a tinted neutral circle without a photo', () => {
    const html = renderToStaticMarkup(<Avatar name="Maria Santos" />)
    expect(html).toContain('data-avatar="initials"')
    expect(html).toContain('bg-slate-200')
    expect(html).toContain('>MS<')
    expect(html).toContain('aria-hidden="true"')
  })

  it('shows the photo when one is available', () => {
    const html = renderToStaticMarkup(<Avatar name="Maria Santos" src="https://example.com/m.png" />)
    expect(html).toContain('data-avatar="photo"')
    expect(html).toContain('src="https://example.com/m.png"')
    expect(html).toContain('alt=""')
  })
})
