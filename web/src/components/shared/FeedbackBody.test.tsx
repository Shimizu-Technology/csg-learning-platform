// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FeedbackBody } from './FeedbackBody'

describe('FeedbackBody', () => {
  it('renders instructor markdown: bold, emphasis, and python fences', () => {
    const html = renderToStaticMarkup(<FeedbackBody feedback={'Explain **why** and *how*.\n\n```python\nif ok:\n    print("yes")\n```'} />)
    expect(html).toContain('<strong>why</strong>')
    expect(html).toContain('<em>how</em>')
    expect(html).toContain('<pre>')
    expect(html).toContain('    print(&quot;yes&quot;)')
    expect(html).not.toContain('```')
  })

  it('does not execute or render raw HTML and script URLs in markdown feedback', () => {
    const html = renderToStaticMarkup(<FeedbackBody feedback={'Hi <img src=x onerror="alert(1)"> <script>alert(2)</script> [link](javascript:alert(3))'} />)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
  })

  it('sanitizes feedback stored as HTML', () => {
    const html = renderToStaticMarkup(<FeedbackBody feedback={'<p>Good <img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a></p>'} />)
    expect(html).toContain('Good')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:')
  })
})
