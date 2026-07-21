interface ClerkErrorShape {
  code?: string;
  message?: string;
  longMessage?: string;
  errors?: ClerkErrorShape[];
}

const FRIENDLY_MESSAGES: Record<string, string> = {
  form_identifier_not_found: 'No Code School account was found for that email.',
  form_password_incorrect: 'That password is not correct. Please try again.',
  strategy_for_user_invalid: 'This account uses a different sign-in method. Try Google sign-in instead.',
  verification_expired: 'That code has expired. Request a new code and try again.',
  form_code_incorrect: 'That verification code is not correct. Please try again.',
  session_exists: 'You are already signed in.',
};

function errorShape(error: unknown): ClerkErrorShape | null {
  if (!error || typeof error !== 'object') return null;
  return error as ClerkErrorShape;
}

export function authErrorMessage(error: unknown, fallback: string) {
  const outer = errorShape(error);
  const clerkError = outer?.errors?.[0] ?? outer;
  if (!clerkError) return fallback;
  if (clerkError.code && FRIENDLY_MESSAGES[clerkError.code]) return FRIENDLY_MESSAGES[clerkError.code];
  return clerkError.longMessage || clerkError.message || fallback;
}

export function isAuthCancellation(error: unknown) {
  const clerkError = errorShape(error);
  const code = clerkError?.errors?.[0]?.code ?? clerkError?.code;
  return code === 'oauth_access_denied' || code === 'user_cancelled' || code === 'ERR_REQUEST_CANCELED';
}
