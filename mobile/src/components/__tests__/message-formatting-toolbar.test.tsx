import { fireEvent, render } from '@testing-library/react-native';

import { MessageFormattingToolbar } from '../message-formatting-toolbar';

// babel-jest hoists this above the imports.
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));

const lance = '**What `git init` does:** it turns the folder into a repo.\n\n```bash\ncd ~\nls -a\n```';

describe('MessageFormattingToolbar Preview (Markdown mode)', () => {
  it('shows the draft through the message renderer and hides it again', () => {
    const screen = render(
      <MessageFormattingToolbar value={lance} selection={{ start: 0, end: 0 }} visible onChange={jest.fn()} onSelectionChange={jest.fn()} onComposerFocus={jest.fn()} onLimitExceeded={jest.fn()} />,
    );
    expect(screen.queryByTestId('composer-preview')).toBeNull();
    fireEvent.press(screen.getByLabelText('Preview'));
    expect(screen.getByLabelText('Preview of message')).toBeTruthy();
    expect(screen.getByText('git init')).toBeTruthy();
    expect(screen.getByText(/ls -a/)).toBeTruthy();
    expect(screen.getByLabelText('Preview').props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(screen.getByLabelText('Preview'));
    expect(screen.queryByTestId('composer-preview')).toBeNull();
  });

  it('previews exactly the body Send posts: unfenced multi-line code shows as code', () => {
    const draft = '\n  const answer = 42;\nconsole.log(answer);\n\n';
    const screen = render(
      <MessageFormattingToolbar value={draft} selection={{ start: 0, end: 0 }} visible onChange={jest.fn()} onSelectionChange={jest.fn()} onComposerFocus={jest.fn()} onLimitExceeded={jest.fn()} />,
    );
    fireEvent.press(screen.getByLabelText('Preview'));
    expect(screen.getByTestId('message-code-block')).toBeTruthy();
    expect(screen.getByTestId('message-code-text').props.children).toBe('  const answer = 42;\nconsole.log(answer);');
  });

  it('has nothing to preview for an empty draft', () => {
    const screen = render(
      <MessageFormattingToolbar value="" selection={{ start: 0, end: 0 }} visible onChange={jest.fn()} onSelectionChange={jest.fn()} onComposerFocus={jest.fn()} onLimitExceeded={jest.fn()} />,
    );
    expect(screen.getByLabelText('Preview').props.accessibilityState).toMatchObject({ disabled: true });
  });
});
