import { authErrorMessage, isAuthCancellation } from '../auth-errors';

describe('authErrorMessage', () => {
  it('maps Clerk credential errors to concise account guidance', () => {
    expect(authErrorMessage({ errors: [{ code: 'form_password_incorrect', message: 'raw' }] }, 'fallback'))
      .toBe('That password is not correct. Please try again.');
  });

  it('uses Clerk detail for an unmapped error and falls back safely', () => {
    expect(authErrorMessage({ longMessage: 'Clerk detail' }, 'fallback')).toBe('Clerk detail');
    expect(authErrorMessage(null, 'fallback')).toBe('fallback');
  });
});

describe('isAuthCancellation', () => {
  it('recognizes nested OAuth cancellation codes', () => {
    expect(isAuthCancellation({ errors: [{ code: 'oauth_access_denied' }] })).toBe(true);
    expect(isAuthCancellation(new Error('network failed'))).toBe(false);
  });
});
