import { expect, it } from 'vitest'
import { reviewTiming } from './reviewCopy'
it.each([[undefined, 'usually within 2 days'], ['usually reviewed within 3 days', 'usually within 3 days'], ['reviewed on Fridays', 'on Fridays'], ['within one school day', 'within one school day']])('turns %s into a natural review clause', (input, expected) => expect(reviewTiming(input)).toBe(expected))
