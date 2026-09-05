import { waitFor } from '@testing-library/react-native';

import type { CsgApi } from '../api';
import { parseCableEnvelope, subscribeToMessages, subscribeToUserMessages } from '../cable';

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];

  readyState = 0;
  sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor() { MockWebSocket.instances.push(this); }

  send(payload: string) { this.sent.push(payload); }
  close() { this.readyState = 3; }
  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({} as Event);
  }
  receive(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
}

function cableApi() {
  return {
    cableToken: jest.fn().mockResolvedValue({ token: 'test-cable-token', expires_in: 60 }),
  } as unknown as CsgApi;
}

describe('parseCableEnvelope', () => {
  it('returns Action Cable message events', () => {
    const event = { event: 'created', channel_id: 4, direct_conversation_id: null, message: { id: 9 } };
    expect(parseCableEnvelope(JSON.stringify({ identifier: '{}', message: event }))).toEqual(event);
  });

  it('validates ephemeral typing events', () => {
    const event = {
      event: 'typing', channel_id: 4, direct_conversation_id: null, thread_root_id: null, active: true,
      user: { id: 9, full_name: 'Ada', avatar_url: null },
    };
    expect(parseCableEnvelope(JSON.stringify({ identifier: '{}', message: event }))).toEqual(event);
    expect(parseCableEnvelope(JSON.stringify({ identifier: '{}', message: { ...event, active: 'true' } }))).toBeNull();
    expect(parseCableEnvelope(JSON.stringify({ identifier: '{}', message: { ...event, user: { id: 9, full_name: 'Ada' } } }))).toBeNull();
    expect(parseCableEnvelope(JSON.stringify({ identifier: '{}', message: { ...event, user: { id: 9, full_name: 'Ada', avatar_url: 4 } } }))).toBeNull();
  });

  it('ignores control frames and malformed payloads', () => {
    expect(parseCableEnvelope(JSON.stringify({ type: 'ping', message: 123 }))).toBeNull();
    expect(parseCableEnvelope('not-json')).toBeNull();
  });
});

describe('native Action Cable subscription', () => {
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    global.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
  });

  it('performs actions only on an open, active socket with the Action Cable payload', async () => {
    const subscription = subscribeToUserMessages(cableApi(), jest.fn());
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];

    expect(subscription.perform('typing', { target_type: 'channel', target_id: 4, active: true })).toBe(false);
    expect(socket.sent).toEqual([]);

    socket.open();
    socket.sent = [];
    expect(subscription.perform('typing', { target_type: 'channel', target_id: 4, active: true })).toBe(true);
    expect(socket.sent.map((payload) => JSON.parse(payload))).toEqual([{
      command: 'message',
      identifier: JSON.stringify({ channel: 'UserMessagesChannel' }),
      data: JSON.stringify({ action: 'typing', target_type: 'channel', target_id: 4, active: true }),
    }]);

    subscription();
    const sentAfterCleanup = socket.sent.length;
    expect(subscription.perform('typing', { active: false })).toBe(false);
    expect(socket.sent).toHaveLength(sentAfterCleanup);
  });

  it('routes typing and durable message events to separate callbacks', async () => {
    const onMessage = jest.fn();
    const onTyping = jest.fn();
    const subscription = subscribeToMessages(cableApi(), 'channel', 4, onMessage, jest.fn(), onTyping);
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    socket.open();

    const typing = {
      event: 'typing', channel_id: 4, direct_conversation_id: null, thread_root_id: null, active: true,
      user: { id: 9, full_name: 'Ada', avatar_url: null },
    };
    const created = { event: 'created', channel_id: 4, direct_conversation_id: null, message: { id: 10 } };
    socket.receive({ identifier: '{}', message: typing });
    socket.receive({ identifier: '{}', message: created });

    expect(onTyping).toHaveBeenCalledWith(typing);
    expect(onMessage).toHaveBeenCalledWith(created);
    subscription();
  });
});
