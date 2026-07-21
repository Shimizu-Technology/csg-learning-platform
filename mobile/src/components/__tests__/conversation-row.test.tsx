import { fireEvent, render } from '@testing-library/react-native';
import { ConversationRow } from '../conversation-row';
import { demoChannels } from '@/lib/demo-data';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { BellOff: Icon, ChevronRight: Icon, Hash: Icon };
});

describe('ConversationRow', () => {
  it('shows unread context and opens the conversation', () => {
    const onPress = jest.fn();
    const screen = render(<ConversationRow kind="channel" item={demoChannels[0]} onPress={onPress} />);

    expect(screen.getByText('general')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Open general'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
