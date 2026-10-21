import { fireEvent, render } from '@testing-library/react-native';

const mockOpenExternalPage = jest.fn().mockResolvedValue(undefined);

jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/analytics', () => ({ analyticsLanguage: (value: string) => value || 'other', captureProductEvent: jest.fn() }));
jest.mock('@/lib/external-links', () => ({ openExternalPage: (url: string) => mockOpenExternalPage(url) }));

// Native dependencies must be mocked before loading the component.
// eslint-disable-next-line import/first
import { AuthoredContent } from '../authored-content';

const STARTER = 'https://code.shimizu-technology.com/?lang=python#project=abc&starter=csg-python-pilot:orientation';

describe('AuthoredContent', () => {
  beforeEach(() => mockOpenExternalPage.mockClear());

  it('keeps every line break and indent of a fenced Markdown code block', () => {
    const screen = render(<AuthoredContent body={'Try this:\n\n```python\namount = 75\nif amount < 100:\n    print("Under budget")\n```\n'} />);

    expect(screen.getByTestId('authored-code-block')).toBeTruthy();
    expect(screen.getByTestId('message-code-text').props.children).toBe('amount = 75\nif amount < 100:\n    print("Under budget")');
    expect(screen.getByText('python')).toBeTruthy();
  });

  it('keeps line breaks in rich-editor HTML code and decodes entities exactly once', () => {
    const screen = render(<AuthoredContent body={'<p>Compare:</p><pre><code class="language-python">if a &lt; b:\n    print(&quot;a &amp;amp; b&quot;)</code></pre>'} />);

    expect(screen.getByTestId('message-code-text').props.children).toBe('if a < b:\n    print("a &amp; b")');
  });

  it('renders feedback Markdown as formatted text, not literal asterisks', () => {
    const screen = render(<AuthoredContent compact body={'**Great first run!** Explain *why* it works.'} />);

    expect(screen.queryByText(/\*\*/)).toBeNull();
    expect(screen.getByText('Great first run!')).toBeTruthy();
  });

  it('does not render script content or raw HTML from Markdown', () => {
    const screen = render(<AuthoredContent body={'Hello\n\n<script>alert(1)</script>'} />);

    expect(screen.queryByText('alert(1)')).toBeNull();
  });

  it('turns a standalone Hafa Code starter link into a button that returns to the lesson', () => {
    const screen = render(<AuthoredContent body={`Start here:\n\n[Open starter in Hafa Code](${STARTER})\n`} starterLinks={{ lessonReturn: { url: 'https://learn.codeschoolofguam.com/lessons/42?cohort_id=7', label: 'Orientation — your first run' }, hint: 'submit' }} />);

    expect(screen.getByTestId('hafa-starter')).toBeTruthy();
    expect(screen.getByText('Run it there, tap Copy code for Learn, then tap Done and paste it here.')).toBeTruthy();
    fireEvent.press(screen.getByRole('link', { name: 'Open starter in Hafa Code' }));

    const opened = mockOpenExternalPage.mock.calls[0][0] as string;
    expect(opened.startsWith(`${STARTER}&return=`)).toBe(true);
    const hash = new URLSearchParams(opened.split('#')[1]);
    expect(hash.get('return')).toBe('https://learn.codeschoolofguam.com/lessons/42?cohort_id=7');
    expect(hash.get('returnLabel')).toBe('Orientation — your first run');
    expect(hash.get('project')).toBe('abc');
  });

  it('leaves ordinary links as inline links', () => {
    const screen = render(<AuthoredContent body={'Read [the docs](https://docs.python.org/3/).'} />);

    expect(screen.queryByTestId('hafa-starter')).toBeNull();
    expect(screen.getByText('the docs')).toBeTruthy();
  });
});
