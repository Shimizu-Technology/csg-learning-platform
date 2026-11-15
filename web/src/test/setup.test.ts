// @vitest-environment jsdom
import { expect, it } from 'vitest'

// The shared setup gives jsdom's Range an empty layout, so the composer's
// deferred selection measurements can't throw after a test finishes.
it('gives every jsdom Range an empty layout', () => {
  const range = document.createRange()
  range.selectNodeContents(document.body)
  expect(range.getClientRects()).toHaveLength(0)
  expect(range.getBoundingClientRect()).toMatchObject({ width: 0, height: 0 })
})
