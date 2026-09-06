import { render } from '@testing-library/react-native';

import { AuthoredContent } from '../authored-content';

const mockRenderHtml = jest.fn((_props: unknown) => null);

jest.mock('react-native-render-html', () => ({
  __esModule: true,
  default: (props: unknown) => mockRenderHtml(props),
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
    }));

    const { ignoreDomNode } = mockRenderHtml.mock.calls[0][0] as { ignoreDomNode: (node: unknown) => boolean };
    expect(ignoreDomNode({ type: 'tag', name: 'img', attribs: { src: 'javascript:alert(1)' } })).toBe(true);
    expect(ignoreDomNode({ type: 'tag', name: 'img', attribs: { src: 'https://images.example.com/lesson.png' } })).toBe(false);
  });
});
