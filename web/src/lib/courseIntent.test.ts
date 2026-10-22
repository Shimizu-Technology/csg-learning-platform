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
