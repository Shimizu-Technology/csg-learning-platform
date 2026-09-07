import { clientMessageIdForSend, conversationHasParticipants, conversationOperationIdentity, createClientMessageId, draftAfterSendConfirmation, draftAfterStoredLoad, messageBodyChangeAllowed, messageBodyLength, messageBodyWithinLimit, messageInsertionWithinLimit, MESSAGE_BODY_LIMIT } from '../message-compose';

describe('message compose contract', () => {
  it('changes the operation identity across conversation and account transitions', () => {
    expect(conversationOperationIdentity(7, 'channel', 11)).not.toBe(conversationOperationIdentity(7, 'channel', 12));
    expect(conversationOperationIdentity(7, 'channel', 11)).not.toBe(conversationOperationIdentity(8, 'channel', 11));
  });

  it('matches a direct conversation only when every participant is the same', () => {
    const twoPersonDm = [{ id: 23 }, { id: 7 }];
    const groupDm = [{ id: 23 }, { id: 7 }, { id: 15 }];

    expect(conversationHasParticipants(twoPersonDm, [7, 23])).toBe(true);
    expect(conversationHasParticipants(twoPersonDm, [23, 7, 15])).toBe(false);
    expect(conversationHasParticipants(groupDm, [23, 7, 15])).toBe(true);
    expect(conversationHasParticipants(groupDm, [23, 7, 99])).toBe(false);
    expect(conversationHasParticipants(groupDm, [23, 7, 7])).toBe(false);
  });

  it('does not overwrite text entered while a stored draft is loading', () => {
    expect(draftAfterStoredLoad('', 'Stored draft')).toBe('Stored draft');
    expect(draftAfterStoredLoad('Typed while loading', 'Stored draft')).toBe('Typed while loading');
  });

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

  it('creates bounded distinct identifiers when randomUUID is unavailable', () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_789_000_000_000);
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.12345);
    try {
      const identifiers = new Set(Array.from({ length: 50 }, () => createClientMessageId()));
      expect(identifiers.size).toBe(50);
      expect(Array.from(identifiers).every((value) => value.startsWith('message-') && value.length <= 100)).toBe(true);
    } finally {
      now.mockRestore();
      random.mockRestore();
      if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
      else Reflect.deleteProperty(globalThis, 'crypto');
    }
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

  it('reconciles response loss when realtime confirms the same authored send intent', () => {
    const intent = { body: 'Possibly delivered', clientMessageId: 'thread-send-1' };

    expect(draftAfterSendConfirmation('Possibly delivered', intent, 'thread-send-1', 7, 7)).toBe('');
    expect(draftAfterSendConfirmation('', intent, 'thread-send-1', 7, 7)).toBe('');
    expect(draftAfterSendConfirmation('Replacement draft', intent, 'thread-send-1', 7, 7)).toBe('Replacement draft');
    expect(draftAfterSendConfirmation('Possibly delivered', intent, 'thread-send-1', 8, 7)).toBeNull();
    expect(draftAfterSendConfirmation('Possibly delivered', intent, 'another-send', 7, 7)).toBeNull();
  });
});
