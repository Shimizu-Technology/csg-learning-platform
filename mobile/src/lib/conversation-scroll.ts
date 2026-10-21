interface ConversationScrollMetrics {
  contentOffset: { y: number };
  contentSize: { height: number };
  layoutMeasurement: { height: number };
}

export function isNearConversationBottom(metrics: ConversationScrollMetrics, threshold = 96, inverted = false) {
  if (inverted) return metrics.contentOffset.y <= threshold;
  const distance = metrics.contentSize.height - metrics.layoutMeasurement.height - metrics.contentOffset.y;
  return distance <= threshold;
}

export function canAutoReadConversation(visible: boolean, positioningAtAnchor: boolean, atBottom: boolean) {
  return visible && !positioningAtAnchor && atBottom;
}

export function formatConversationDay(value: string, now = new Date()) {
  const date = new Date(value);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDifference = Math.round((
    Date.UTC(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate())
    - Date.UTC(startOfDate.getFullYear(), startOfDate.getMonth(), startOfDate.getDate())
  ) / 86_400_000);

  if (dayDifference === 0) return 'Today';
  if (dayDifference === 1) return 'Yesterday';

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  }).format(date);
}

export function isDifferentConversationDay(current: string, previous?: string) {
  if (!previous) return true;
  const currentDate = new Date(current);
  const previousDate = new Date(previous);
  return currentDate.getFullYear() !== previousDate.getFullYear()
    || currentDate.getMonth() !== previousDate.getMonth()
    || currentDate.getDate() !== previousDate.getDate();
}

/**
 * Tracks which scroll request is current. Jumping to the latest message
 * invalidates every pending scroll that was scheduled before it, so a delayed
 * fallback (for example after `onScrollToIndexFailed`) cannot pull the list
 * back to an older position.
 */
export function createScrollGeneration() {
  let current = 0;
  return {
    invalidate: () => { current += 1; return current; },
    capture: () => current,
    isCurrent: (generation: number) => generation === current,
  };
}
