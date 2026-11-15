// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { courseAuthPath, courseIntentDestination, offeringIdFrom } from './courseIntent'
it('keeps course identity across both auth screens', () => {
  expect(courseAuthPath('/sign-in', '?offering_id=13')).toBe('/sign-in?offering_id=13')
  expect(courseAuthPath('/sign-up', '?offering_id=13')).toBe('/sign-up?offering_id=13')
  expect(courseIntentDestination('?offering_id=13')).toBe('/courses?offering_id=13')
})
it.each(['-1', '0', '1.2', 'Infinity', '9007199254740992', 'https://evil.test'])('rejects malformed intent %s', (id) => {
  expect(offeringIdFrom(`?offering_id=${id}`)).toBeNull()
  expect(courseIntentDestination(`?offering_id=${id}&redirect_url=https://evil.test`)).toBe('/dashboard')
})
it('preserves an ownership-checked confirmation destination after reauthentication', () => {
  expect(courseAuthPath('/sign-in', '?checkout=return&purchase_id=20')).toBe('/sign-in?checkout=return&purchase_id=20')
  expect(courseIntentDestination('?checkout=return&purchase_id=20')).toBe('/courses?checkout=return&purchase_id=20')
})
it('carries sanitized redirects across auth screens, including the redirect alias', () => {
  const destination = '/messages/dm/6?message_id=42#message-42'
  for (const key of ['redirect_url', 'redirect']) {
    const search = `?${new URLSearchParams({ [key]: destination })}`
    expect(courseIntentDestination(search)).toBe(destination)
    expect(courseAuthPath('/sign-up', search)).toBe(`/sign-up?${new URLSearchParams({ redirect_url: destination })}`)
  }
  expect(courseIntentDestination('?redirect_url=%2Fsign-in')).toBe('/dashboard')
  expect(courseIntentDestination('?offering_id=13&redirect_url=%2Fmessages')).toBe('/courses?offering_id=13')
})
it.each(['/.//evil.com', '/a/..//evil.com', '/%2e//evil.com', '/%2e%2e//evil.com', '/a/%252e%252e/%252fevil.com', '/a/../%2fevil.com', '/%2e%2e/%5cevil.com'])('rejects normalized course redirect %s', value => {
  expect(courseIntentDestination(`?${new URLSearchParams({ redirect_url: value })}`)).toBe('/dashboard')
})
it('rejects the reported encoded course redirect', () => {
  expect(courseIntentDestination('?redirect_url=%2F.%2F%2Fevil.com')).toBe('/dashboard')
})
it('supports the mobile ClerkWebHandoffService absolute URL shape', () => {
  const search = `?${new URLSearchParams({ redirect_url: `${window.location.origin}/lessons/3` })}`
  expect(courseIntentDestination(search)).toBe('/lessons/3')
  expect(courseAuthPath('/sign-up', search)).toBe('/sign-up?redirect_url=%2Flessons%2F3')
  expect(courseIntentDestination('', '')).toBe('')
})
