import { parseCableEnvelope } from '../cable';

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
