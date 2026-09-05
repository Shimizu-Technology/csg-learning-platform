import { createClientMessageId, MESSAGE_BODY_LIMIT } from '../message-compose';

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
});
