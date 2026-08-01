import { fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';

import type { Message } from '@/lib/types';
import { MessageBubble } from '../message-bubble';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    Check: Icon,
    FileText: Icon,
    Heart: Icon,
    Laugh: Icon,
    Lightbulb: Icon,
    MessageSquare: Icon,
    Pin: Icon,
    RefreshCw: Icon,
    ThumbsUp: Icon,
    TriangleAlert: Icon,
  };
});

const message: Message = {
  id: 42,
  channel_id: 7,
  direct_conversation_id: null,
  parent_message_id: null,
  body: 'Here is the screenshot.',
  mention_user_ids: [],
  edited_at: null,
  deleted_at: null,
  pinned_at: null,
  created_at: '2026-07-25T00:00:00.000Z',
  updated_at: '2026-07-25T00:00:00.000Z',
  mine: false,
  reactions: [{
    emoji: '👍',
    count: 2,
    reacted: true,
    users: [
      { id: 2, full_name: 'Maya Santos', avatar_url: null },
      { id: 3, full_name: 'Kai Perez', avatar_url: null },
    ],
  }],
  attachments: [{
    id: 9,
    filename: 'layout.png',
    content_type: 'image/png',
    byte_size: 1_024,
    image: true,
    url: 'https://example.com/layout.png',
  }],
  author: { id: 2, full_name: 'Maya Santos', email: 'maya@example.com', role: 'student', avatar_url: null },
};

describe('MessageBubble', () => {
  it('opens reaction details instead of removing a reaction immediately', () => {
    const onOpenReaction = jest.fn();
    const screen = render(<MessageBubble message={message} showAuthor mentionUsers={[]} onOpenReaction={onOpenReaction} />);

    fireEvent.press(screen.getByLabelText('Thumbs up, 2'));

    expect(onOpenReaction).toHaveBeenCalledWith(message, '👍');
  });

  it('opens image attachments in the native preview flow', () => {
    const onOpenImage = jest.fn();
    const screen = render(<MessageBubble message={message} showAuthor mentionUsers={[]} onOpenImage={onOpenImage} />);

    fireEvent.press(screen.getByLabelText('Preview layout.png'));

    expect(onOpenImage).toHaveBeenCalledWith(message.attachments[0], message.attachments);
  });

  it('renders fenced code, lists, quotes, and inline formatting without showing markdown markers', () => {
    const formatted = {
      ...message,
      body: '```sh\nls - list\n```\n\n- **First**\n- `Second`\n\n> Remember this',
      attachments: [],
    };
    const screen = render(<MessageBubble message={formatted} showAuthor mentionUsers={[]} />);

    expect(screen.getByText('sh')).toBeTruthy();
    expect(screen.getByText('ls - list')).toBeTruthy();
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Second')).toBeTruthy();
    expect(screen.getByText('Remember this')).toBeTruthy();
    expect(screen.queryByText(/```/)).toBeNull();
  });

  it('opens safe links from formatted message text', () => {
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(true);
    const linked = { ...message, body: 'Read [the guide](https://example.com/docs).', attachments: [] };
    const screen = render(<MessageBubble message={linked} showAuthor mentionUsers={[]} />);

    fireEvent.press(screen.getByRole('link'));

    expect(openUrl).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('opens the complete destination when a markdown link URL contains parentheses', () => {
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(true);
    const href = 'https://en.wikipedia.org/wiki/Function_(computer_programming)';
    const linked = { ...message, body: `Read [about functions](${href}).`, attachments: [] };
    const screen = render(<MessageBubble message={linked} showAuthor mentionUsers={[]} />);

    fireEvent.press(screen.getByRole('link'));

    expect(openUrl).toHaveBeenCalledWith(href);
    expect(screen.queryByText(').')).toBeNull();
  });
});
