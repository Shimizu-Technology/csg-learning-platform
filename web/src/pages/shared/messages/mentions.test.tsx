import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { FormattedMessage } from './FormattedMessage'
import { resolveMentionedUserIds } from './mentions'
const patterns = [
  { label: '@Alex', normalized: '@alex', kind: 'user' as const, userId: 1, me: false },
  { label: '@Alex', normalized: '@alex', kind: 'user' as const, userId: 2, me: true },
]
const render = (body: string, ids: number[]) => renderToStaticMarkup(<FormattedMessage body={body} mentionPatterns={patterns} mentionUserIds={ids} />)
it('gates same-name mentions and mentions-me color on the stored id', () => {
  expect(render('@Alex', [])).not.toContain('rounded-full')
  expect(render('@Alex', [1])).toContain('bg-info-100')
  expect(render('@Alex', [1])).not.toContain('bg-ruby-100')
  expect(render('@Alex', [2])).toContain('bg-ruby-100')
})
it('does not assign an old label to a renamed or different same-name user', () => {
  expect(render('@Alex', [3])).not.toContain('rounded-full')
})
it('does not highlight or resolve a code mention even with a stored id', () => {
  expect(render('`@Alex`', [2])).not.toContain('rounded-full')
  const person = { id: 2, full_name: 'Alex', email: '', role: 'student' as const, cohort_name: null }
  expect(resolveMentionedUserIds('`@Alex hello`', [person], [2])).toEqual([])
})
