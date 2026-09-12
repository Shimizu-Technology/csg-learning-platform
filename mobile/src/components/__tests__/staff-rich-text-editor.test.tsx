import { fireEvent, render } from '@testing-library/react-native';

const mockInjectJavaScript = jest.fn();
const mockUseWindowDimensions = jest.fn(() => ({ fontScale: 1, height: 844, scale: 3, width: 390 }));

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { Bold: Icon, Code2: Icon, Italic: Icon, Link: Icon, List: Icon, ListOrdered: Icon, Quote: Icon, Redo2: Icon, Undo2: Icon };
});
jest.mock('react-native-webview', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const MockWebView = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ injectJavaScript: mockInjectJavaScript }));
    return React.createElement(View, { ...props, testID: 'rich-text-webview' });
  });
  MockWebView.displayName = 'MockWebView';
  return { WebView: MockWebView };
});
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockUseWindowDimensions(),
}));

// Native dependencies must be mocked before loading the component.
// eslint-disable-next-line import/first
import { StaffRichTextEditor } from '../staff-rich-text-editor';

beforeEach(() => {
  jest.clearAllMocks();
  mockUseWindowDimensions.mockReturnValue({ fontScale: 1, height: 844, scale: 3, width: 390 });
});

describe('native staff rich text editor', () => {
  it('loads existing HTML visually and returns edited semantic HTML', () => {
    const onChange = jest.fn();
    const screen = render(<StaffRichTextEditor value="<p><strong>Existing</strong> lesson</p>" onChange={onChange} />);
    const webview = screen.getByTestId('rich-text-webview');

    expect(webview.props.source.html).toContain('\\u003cp\\u003e\\u003cstrong\\u003eExisting');
    fireEvent(webview, 'message', { nativeEvent: { data: '{"type":"content","html":"<p><em>Updated</em></p>"}' } });

    expect(onChange).toHaveBeenCalledWith('<p><em>Updated</em></p>');
  });

  it('sends formatting commands and reflects the current selection', () => {
    const screen = render(<StaffRichTextEditor value="Build it" onChange={jest.fn()} />);
    const webview = screen.getByTestId('rich-text-webview');
    expect(screen.getByRole('button', { name: 'Bold' }).props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(screen.getByRole('button', { name: 'Bold' }));
    expect(mockInjectJavaScript).not.toHaveBeenCalled();
    fireEvent(webview, 'message', { nativeEvent: { data: '{"type":"ready"}' } });
    fireEvent(webview, 'message', { nativeEvent: { data: '{"type":"selection","state":{"bold":true,"italic":false,"link":false,"blockquote":false,"inlineCode":false,"codeBlock":false,"bulletList":false,"orderedList":false,"canUndo":true,"canRedo":false}}' } });

    expect(screen.getByRole('button', { name: 'Bold' }).props.accessibilityState).toMatchObject({ selected: true, disabled: false });
    fireEvent.press(screen.getByRole('button', { name: 'Italic' }));
    expect(mockInjectJavaScript).toHaveBeenCalledWith(expect.stringContaining('"italic"'));
  });

  it('validates links before applying them to the saved web selection', () => {
    const screen = render(<StaffRichTextEditor value="Read this" onChange={jest.fn()} />);
    fireEvent(screen.getByTestId('rich-text-webview'), 'message', { nativeEvent: { data: '{"type":"ready"}' } });
    fireEvent.press(screen.getByRole('button', { name: 'Link' }));
    expect(mockInjectJavaScript).toHaveBeenCalledWith(expect.stringContaining('"prepareLink"'));

    fireEvent.changeText(screen.getByLabelText('Instruction link URL'), 'javascript:alert(1)');
    fireEvent.press(screen.getByText('Apply link'));
    expect(screen.getByText('Use a full http, https, or mailto link.')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Instruction link URL'), 'https://codeschoolofguam.com');
    fireEvent.press(screen.getByText('Apply link'));
    expect(mockInjectJavaScript).toHaveBeenLastCalledWith(expect.stringContaining('https://codeschoolofguam.com'));
  });

  it('preserves a safe read-only preview and retry when the native editing surface cannot load', () => {
    const onChange = jest.fn();
    const screen = render(<StaffRichTextEditor value={'<p onclick="steal()">Keep this safe</p><script>steal()</script>'} onChange={onChange} />);
    fireEvent(screen.getByTestId('rich-text-webview'), 'error');

    expect(screen.getByText('Formatting tools are unavailable')).toBeTruthy();
    expect(screen.getByText('Keep this safe')).toBeTruthy();
    expect(screen.queryByText('steal()')).toBeNull();
    expect(screen.queryByLabelText('Exercise instructions')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Retry formatting editor'));
    expect(screen.getByTestId('rich-text-webview')).toBeTruthy();
  });

  it('rebuilds a failed editor from the latest emitted value before retrying', () => {
    const onChange = jest.fn();
    const screen = render(<StaffRichTextEditor value="<p>Original</p>" onChange={onChange} />);
    fireEvent(screen.getByTestId('rich-text-webview'), 'message', { nativeEvent: { data: '{"type":"content","html":"<p>Latest safe value</p>"}' } });
    expect(onChange).toHaveBeenCalledWith('<p>Latest safe value</p>');

    screen.rerender(<StaffRichTextEditor value="<p>Latest safe value</p>" onChange={onChange} />);
    fireEvent(screen.getByTestId('rich-text-webview'), 'error');
    expect(screen.getByText('Latest safe value')).toBeTruthy();
    fireEvent.press(screen.getByText('Retry formatting editor'));

    expect(screen.getByTestId('rich-text-webview').props.source.html).toContain('Latest safe value');
  });

  it('applies a Dynamic Type change without replacing the current editor document', () => {
    const screen = render(<StaffRichTextEditor value="<p>Keep my edit</p>" onChange={jest.fn()} />);
    const originalDocument = screen.getByTestId('rich-text-webview').props.source.html;
    fireEvent(screen.getByTestId('rich-text-webview'), 'message', { nativeEvent: { data: '{"type":"ready"}' } });
    mockInjectJavaScript.mockClear();

    mockUseWindowDimensions.mockReturnValue({ fontScale: 2, height: 844, scale: 3, width: 390 });
    screen.rerender(<StaffRichTextEditor value="<p>Keep my edit</p>" onChange={jest.fn()} />);

    expect(screen.getByTestId('rich-text-webview').props.source.html).toBe(originalDocument);
    expect(mockInjectJavaScript).toHaveBeenCalledWith(expect.stringContaining('"setFontSize", "32"'));
  });
});
