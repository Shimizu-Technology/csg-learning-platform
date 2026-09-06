import { render } from '@testing-library/react-native';

import { AuthoredContent } from '../authored-content';

const mockRenderHtml = jest.fn((_props: unknown) => null);

jest.mock('react-native-render-html', () => ({
  __esModule: true,
  default: (props: unknown) => mockRenderHtml(props),
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
  });
});
