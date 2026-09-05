import { clientMessageIdForSend, createClientMessageId, messageInsertionWithinLimit, MESSAGE_BODY_LIMIT } from '../message-compose';

describe('message compose contract', () => {
  it('matches the API body limit', () => {
    expect(MESSAGE_BODY_LIMIT).toBe(5_000);
  });

  it('creates distinct client message identifiers that fit the API contract', () => {
    const first = createClientMessageId();
    const second = createClientMessageId();

    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
    expect(first.length).toBeLessThanOrEqual(100);
  });

  it('reuses a failed send identifier only while the body is unchanged', () => {
    const failed = { body: 'Retry me', clientMessageId: 'send-1' };

    expect(clientMessageIdForSend('Retry me', failed)).toBe('send-1');
    expect(clientMessageIdForSend('Changed body', failed)).not.toBe('send-1');
  });

  it('rejects programmatic insertions that exceed the API body limit', () => {
    const current = 'a'.repeat(MESSAGE_BODY_LIMIT - 1);

    expect(messageInsertionWithinLimit(`${current}@member `, current.length + 8)).toBeNull();
    expect(messageInsertionWithinLimit('Hi @Maya ', 9)).toEqual({ value: 'Hi @Maya ', cursor: 9 });
  });
});
