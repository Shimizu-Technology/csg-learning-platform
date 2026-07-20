import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FormattedMessage } from './Messages'

describe('FormattedMessage', () => {
  it('renders mobile-safe semantic lists and formatting', () => {
    const html = renderToStaticMarkup(
      <FormattedMessage body={'- **First** item\n- ++Second++ item\n\n1. One\n2. ~~Two~~'} />,
    )

    expect(html).toContain('<ul')
    expect(html).toContain('<ol')
    expect(html).toContain('<strong>First</strong>')
    expect(html).toContain('<u>Second</u>')
    expect(html).toContain('<del>Two</del>')
    expect(html.match(/<li/g)).toHaveLength(4)
  })

  it('preserves combined marks and formatted link labels after sending', () => {
    const html = renderToStaticMarkup(
      <FormattedMessage body={'_**Bold italic**_ and [++underlined link++](https://example.com)'} />,
    )

    expect(html).toContain('<em><strong>Bold italic</strong></em>')
    expect(html).toContain('<a')
    expect(html).toContain('<u>underlined link</u>')
    expect(html).toContain('href="https://example.com"')
  })
})
