import { parseCableEnvelope } from '../cable';

describe('parseCableEnvelope', () => {
  it('returns Action Cable message events', () => {
    const event = { event: 'created', channel_id: 4, direct_conversation_id: null, message: { id: 9 } };
    expect(parseCableEnvelope(JSON.stringify({ identifier: '{}', message: event }))).toEqual(event);
  });

  it('ignores control frames and malformed payloads', () => {
    expect(parseCableEnvelope(JSON.stringify({ type: 'ping', message: 123 }))).toBeNull();
    expect(parseCableEnvelope('not-json')).toBeNull();
  });
});
