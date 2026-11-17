/**
 * One client request id per help-request reply attempt (PR #282 fix round 1).
 * A send that fails, or whose response is lost, is retried with the same id,
 * so the server returns the reply it already saved instead of answering, and
 * notifying the learner, twice. Clear it once a reply is confirmed.
 */
export const newReplyRequestId = () => `reply-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
