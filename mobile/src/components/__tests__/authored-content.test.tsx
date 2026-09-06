import { render } from '@testing-library/react-native';

import { AuthoredContent } from '../authored-content';

const mockRenderHtml = jest.fn((_props: unknown) => null);

jest.mock('react-native-render-html', () => ({
  __esModule: true,
  default: (props: unknown) => mockRenderHtml(props),
  defaultSystemFonts: ['System'],
  isDomElement: (node: { type?: string }) => node.type === 'tag',
}));

describe('AuthoredContent', () => {
  beforeEach(() => mockRenderHtml.mockClear());

  it('passes rich-editor HTML to the native renderer instead of displaying tag text', () => {
    const body = '<p><strong>Great work!</strong></p><ul><li>Rails API</li></ul>';
    render(<AuthoredContent body={body} />);

    expect(mockRenderHtml).toHaveBeenCalledWith(expect.objectContaining({
      source: { html: body },
      enableCSSInlineProcessing: false,
      ignoredDomTags: expect.arrayContaining(['script', 'iframe', 'form', 'svg']),
      renderers: expect.objectContaining({ pre: expect.any(Function) }),
      systemFonts: expect.arrayContaining(['System', 'Manrope_400Regular', 'Manrope_700Bold', 'Manrope_800ExtraBold', 'Menlo']),
    }));

    const { ignoreDomNode } = mockRenderHtml.mock.calls[0][0] as { ignoreDomNode: (node: unknown) => boolean };
    expect(ignoreDomNode({ type: 'tag', name: 'img', attribs: { src: 'javascript:alert(1)' } })).toBe(true);
    expect(ignoreDomNode({ type: 'tag', name: 'img', attribs: { src: 'https://images.example.com/lesson.png' } })).toBe(false);
  });

  it('renders preformatted content inside a horizontal scroller', () => {
    render(<AuthoredContent body="<pre><code>const line = 'intentionally very long';</code></pre>" />);

    const { renderers } = mockRenderHtml.mock.calls[0][0] as {
      renderers: { pre: (props: { TDefaultRenderer: () => null; tnode: unknown; viewProps: object }) => React.ReactElement };
    };
    const DefaultRenderer = jest.fn(() => null);
    const renderedPre = renderers.pre({
      TDefaultRenderer: DefaultRenderer,
      tnode: { type: 'block', children: [{ type: 'text', data: 'const line = intentionally very long;' }] },
      viewProps: {},
    });
    const { getByTestId } = render(renderedPre);

    expect(getByTestId('authored-code-scroller')).toHaveProp('horizontal', true);
    expect(getByTestId('authored-code-scroller')).toHaveProp('accessibilityHint', 'Drag horizontally to read long lines');
    expect(getByTestId('authored-code-scroller')).toHaveStyle({ maxWidth: '100%' });
    expect(DefaultRenderer).toHaveBeenCalledTimes(1);
    expect(DefaultRenderer).toHaveBeenCalledWith(expect.objectContaining({
      viewProps: expect.objectContaining({ style: expect.arrayContaining([
        expect.objectContaining({ flexGrow: 1, minWidth: expect.any(Number) }),
      ]) }),
    }), undefined);
  });
});
