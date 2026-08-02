import * as Clipboard from 'expo-clipboard';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { MessageCodeBlock } from '../message-code-block';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { Check: Icon, Copy: Icon, MoveHorizontal: Icon };
});

describe('MessageCodeBlock', () => {
  it('keeps code intrinsically wide inside a horizontal scroll view', () => {
    const code = `const endpoint = "${'a'.repeat(180)}";`;
    const screen = render(<MessageCodeBlock code={code} language="ts" />);
    const scroller = screen.getByTestId('message-code-scroller');
    const codeText = screen.getByTestId('message-code-text');

    expect(scroller.props.horizontal).toBe(true);
    expect(scroller.props.directionalLockEnabled).toBe(true);
    expect(scroller.props.nestedScrollEnabled).toBe(true);
    expect(StyleSheet.flatten(codeText.props.style)).toMatchObject({ alignSelf: 'flex-start', flexShrink: 0 });
    expect(codeText.props.selectable).toBeUndefined();
  });

  it('reveals horizontal guidance only when content is wider than the viewport', () => {
    const screen = render(<MessageCodeBlock code={'x'.repeat(180)} language="sh" />);

    fireEvent(screen.getByTestId('message-code-viewport'), 'layout', { nativeEvent: { layout: { width: 220, height: 40, x: 0, y: 0 } } });
    fireEvent(screen.getByTestId('message-code-text'), 'textLayout', {
      nativeEvent: { lines: [{ width: 496 }] },
    });

    expect(screen.getByText('Drag')).toBeTruthy();
    expect(screen.getByLabelText('Code continues horizontally. Drag to read more.')).toBeTruthy();
    expect(screen.getByLabelText('Code block, scroll horizontally for more')).toBeTruthy();
    expect(screen.getByTestId('message-code-scroller').props.showsHorizontalScrollIndicator).toBe(true);
    expect(StyleSheet.flatten(screen.getByTestId('message-code-scroller').props.contentContainerStyle).minWidth).toBeGreaterThanOrEqual(520);

    fireEvent.scroll(screen.getByTestId('message-code-scroller'), {
      nativeEvent: { contentOffset: { x: 100, y: 0 } },
    });
    expect(screen.queryByLabelText('Scroll code left')).toBeNull();
    expect(screen.queryByLabelText('Scroll code right')).toBeNull();
  });

  it('does not offer horizontal navigation for code that fits', () => {
    const screen = render(<MessageCodeBlock code="const ready = true;" language="ts" />);

    fireEvent(screen.getByTestId('message-code-viewport'), 'layout', { nativeEvent: { layout: { width: 320, height: 40, x: 0, y: 0 } } });
    fireEvent(screen.getByTestId('message-code-text'), 'textLayout', {
      nativeEvent: { lines: [{ width: 112 }] },
    });

    expect(screen.queryByText('Drag')).toBeNull();
    expect(screen.queryByLabelText('Scroll code right')).toBeNull();
    expect(screen.getByLabelText('Code block')).toBeTruthy();
    expect(screen.getByTestId('message-code-scroller').props.showsHorizontalScrollIndicator).toBe(false);
  });

  it('copies the complete code block through an explicit accessible action', async () => {
    const code = `bundle exec rails test\n${'final-character-'.repeat(20)}END`;
    const screen = render(<MessageCodeBlock code={code} language="sh" />);

    fireEvent.press(screen.getByLabelText('Copy code'));

    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(code));
    expect(screen.getByLabelText('Code copied')).toBeTruthy();
  });
});
