import { fireEvent, render } from '@testing-library/react-native';
import { ConversationRow } from '../conversation-row';
import { demoChannels, demoDms } from '@/lib/demo-data';
import type { ChannelSummary } from '@/lib/types';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { BellOff: Icon, ChevronRight: Icon, Hash: Icon, Lock: Icon, Users: Icon };
});

describe('ConversationRow', () => {
  it('shows unread context and opens the conversation', () => {
    const onPress = jest.fn();
    const screen = render(<ConversationRow kind="channel" item={demoChannels[0]} onPress={onPress} />);

    expect(screen.getByText('general')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Open general, 3 unread'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows a readable one-line preview instead of raw markdown', () => {
    const item: ChannelSummary = {
      ...demoChannels[0],
      latest_message: {
        id: 99,
        author_id: 42,
        author_name: 'Instructor',
        created_at: '2026-08-01T00:00:00.000Z',
        body: '```sh\nls - list\n```\n\n- **Open** the folder',
      },
    };
    const screen = render(<ConversationRow kind="channel" item={item} currentUserId={1} onPress={jest.fn()} />);

    expect(screen.getByText('Instructor: ls - list Open the folder')).toBeTruthy();
    expect(screen.queryByText(/```/)).toBeNull();
  });

  it('attributes You: strictly by author_id and shows Draft: preview when a draft exists', () => {
    const ownChannel: ChannelSummary = {
      ...demoChannels[0],
      unread_count: 0,
      latest_message: {
        id: 100,
        author_id: 7,
        author_name: 'Leon Shimizu',
        created_at: '2026-08-01T00:00:00.000Z',
        body: 'Office hours start at 6 PM',
      },
    };
    const screen = render(<ConversationRow kind="channel" item={ownChannel} currentUserId={7} onPress={jest.fn()} />);
    expect(screen.getByText('You: Office hours start at 6 PM')).toBeTruthy();

    // Same display name with different author_id must NOT be attributed to "You:".
    const sameNameOther: ChannelSummary = {
      ...ownChannel,
      latest_message: { ...ownChannel.latest_message!, author_id: 999 },
    };
    screen.rerender(<ConversationRow kind="channel" item={sameNameOther} currentUserId={7} onPress={jest.fn()} />);
    expect(screen.getByText('Leon Shimizu: Office hours start at 6 PM')).toBeTruthy();

    // Draft preview replaces latest message preview and is included in accessibility label.
    screen.rerender(
      <ConversationRow
        kind="dm"
        item={demoDms[0]}
        currentUserId={7}
        draftPreview="Finishing the PR check now"
        online
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText(/Draft:/)).toBeTruthy();
    expect(screen.getByText(/Finishing the PR check now/)).toBeTruthy();
    expect(screen.getByLabelText(/Draft: Finishing the PR check now/)).toBeTruthy();
    expect(screen.getByLabelText(/Active now/)).toBeTruthy();

    // Offline 1:1 DM omits "Active now" from the accessibility label.
    screen.rerender(
      <ConversationRow
        kind="dm"
        item={demoDms[0]}
        currentUserId={7}
        online={false}
        onPress={jest.fn()}
      />,
    );
    expect(screen.queryByLabelText(/Active now/)).toBeNull();
  });
});
