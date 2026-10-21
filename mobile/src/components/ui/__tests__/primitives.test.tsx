import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Button } from '../button';
import { Badge } from '../badge';
import { Card } from '../card';
import { EmptyState } from '../empty-state';
import { LoadingState } from '../loading-state';
import { StatusRow } from '../status-row';
import { PressableScale } from '../pressable-scale';
import { CodeBlock } from '../code-block';

jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../../lib/analytics', () => ({ analyticsLanguage: jest.fn(), captureProductEvent: jest.fn() }));
it.each(['primary', 'secondary', 'quiet', 'danger'] as const)('Button %s labels and activation', (variant) => {
  const onPress = jest.fn(); const ui = render(<Button label="Save work" variant={variant} onPress={onPress} />);
  fireEvent.press(ui.getByRole('button', { name: 'Save work' })); expect(onPress).toHaveBeenCalledTimes(1);
});
it('loading and disabled buttons prevent duplicate actions', () => {
  const onPress = jest.fn(); const ui = render(<Button label="Save" loading onPress={onPress} />);
  expect(ui.getByRole('button').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  fireEvent.press(ui.getByRole('button')); expect(onPress).not.toHaveBeenCalled();
  ui.rerender(<Button label="Save" disabled onPress={onPress} />); fireEvent.press(ui.getByRole('button')); expect(onPress).not.toHaveBeenCalled();
});
it.each(['neutral', 'pending', 'success', 'warning', 'danger', 'brand'] as const)('Badge %s keeps its label', (tone) => { expect(render(<Badge label="Awaiting review" tone={tone} />).getByText('Awaiting review')).toBeTruthy(); });
it('Card preserves content and accessible action', () => { const tap = jest.fn(); const ui = render(<Card label="Open lesson" onPress={tap}><Text>Lesson 1</Text></Card>); fireEvent.press(ui.getByRole('button')); expect(tap).toHaveBeenCalledTimes(1); });
it('EmptyState provides the recovery action', () => { const tap = jest.fn(); const ui = render(<EmptyState title="No lessons yet" copy="Your instructor will open your course." action={{ label: 'Message instructor', onPress: tap }} />); fireEvent.press(ui.getByText('Message instructor')); expect(tap).toHaveBeenCalledTimes(1); });
it('LoadingState names the pending operation', () => { expect(render(<LoadingState label="Loading today" />).getByRole('progressbar', { name: 'Loading today' })).toBeTruthy(); });
it('StatusRow uses canonical learner status language', () => { const ui = render(<StatusRow status="awaiting_review" detail="Your instructor will review this." />); expect(ui.getByText('Submitted · awaiting review')).toBeTruthy(); });
it('PressableScale preserves labels and fires only once per action', () => { const tap=jest.fn(); const ui=render(<PressableScale accessibilityRole="button" accessibilityLabel="Open card" onPress={tap}><Text>Card</Text></PressableScale>); fireEvent.press(ui.getByRole('button')); expect(tap).toHaveBeenCalledTimes(1); });
it('CodeBlock retains raw indentation and newlines', () => { const code='for x in values:\n    print(x)'; const ui=render(<CodeBlock code={code} />); expect(ui.getByTestId('message-code-text').props.children).toBe(code); });

it('wraps interpolated text children for native controls', () => {
  const ui = render(<Button variant="secondary">Past weeks ({2})</Button>);
  expect(ui.getByText('Past weeks (2)')).toBeTruthy();
});
