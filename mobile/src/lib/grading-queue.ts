import type { Submission } from './types';
export type GradingQueueTarget = Pick<Submission, 'id' | 'cohort_id' | 'user_id'>;
export type GradingQueue = { submissions: GradingQueueTarget[]; cohortId?: number | null; filter?: 'ungraded' | 'redo' };
export const gradingQueueKey = (userId: number, token: string) => ['grading-navigation', userId, token] as const;
export function gradingQueuePosition(queue: GradingQueue | undefined, id: number) {
  const index = queue?.submissions.findIndex(item => item.id === id) ?? -1;
  return { index, total: queue?.submissions.length ?? 0, previous: index > 0 ? queue?.submissions[index - 1] : undefined, next: queue?.submissions[index + 1] };
}

let sequence = 0;
export function nextGradingQueueToken() { return String(++sequence); }
