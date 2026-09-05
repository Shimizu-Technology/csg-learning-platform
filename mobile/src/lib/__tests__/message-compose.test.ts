import { clientMessageIdForSend, createClientMessageId, messageBodyChangeAllowed, messageBodyLength, messageBodyWithinLimit, messageInsertionWithinLimit, MESSAGE_BODY_LIMIT } from '../message-compose';

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
    expect(clientMessageIdForSend('  Retry me  ', failed)).toBe('send-1');
    expect(clientMessageIdForSend('Changed body', failed)).not.toBe('send-1');
  });

  it('rejects programmatic insertions that exceed the API body limit', () => {
    const current = 'a'.repeat(MESSAGE_BODY_LIMIT - 1);

    expect(messageInsertionWithinLimit(`${current}@member `, current.length + 8)).toBeNull();
    expect(messageInsertionWithinLimit('Hi @Maya ', 9)).toEqual({ value: 'Hi @Maya ', cursor: 9 });
  });

  it('counts Unicode code points the same way as the API', () => {
    const boundary = '🚀'.repeat(MESSAGE_BODY_LIMIT);

    expect(messageBodyWithinLimit(boundary)).toBe(true);
    expect(messageInsertionWithinLimit(boundary, boundary.length)).toEqual({ value: boundary, cursor: boundary.length });
    expect(messageBodyWithinLimit(`${boundary}🚀`)).toBe(false);
    expect(messageInsertionWithinLimit(`${boundary}🚀`, boundary.length + 2)).toBeNull();
    expect(messageBodyLength(boundary)).toBe(MESSAGE_BODY_LIMIT);
  });

  it('lets a legacy over-limit draft be shortened but not lengthened', () => {
    const legacyDraft = 'a'.repeat(MESSAGE_BODY_LIMIT + 2);

    expect(messageBodyChangeAllowed(legacyDraft, legacyDraft.slice(0, -1))).toBe(true);
    expect(messageBodyChangeAllowed(legacyDraft, `${legacyDraft}a`)).toBe(false);
  });
});
