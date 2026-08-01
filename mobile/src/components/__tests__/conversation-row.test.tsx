import { fireEvent, render } from '@testing-library/react-native';
import { ConversationRow } from '../conversation-row';
import { demoChannels } from '@/lib/demo-data';
import type { ChannelSummary } from '@/lib/types';

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

  it('shows a readable one-line preview instead of raw markdown', () => {
    const item: ChannelSummary = {
      ...demoChannels[0],
      latest_message: {
        id: 99,
        author_name: 'Instructor',
        created_at: '2026-08-01T00:00:00.000Z',
        body: '```sh\nls - list\n```\n\n- **Open** the folder',
      },
    };
    const screen = render(<ConversationRow kind="channel" item={item} onPress={jest.fn()} />);

    expect(screen.getByText('Instructor: ls - list Open the folder')).toBeTruthy();
    expect(screen.queryByText(/```/)).toBeNull();
  });
});
