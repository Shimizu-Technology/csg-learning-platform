import { fireEvent, render } from '@testing-library/react-native';

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
});
