import { useMutation } from '@tanstack/react-query';
import { Text } from 'react-native';
import { LearningCard, SectionHeading } from './learning-ui';
import { Button } from './ui/button';
import { useTheme } from '@/providers/theme-provider';
import { githubIssueUrl, openExternalPage } from '@/lib/external-links';
import { themedAlert as Alert } from '@/lib/alerts';
import type { Submission } from '@/lib/types';
import { gradeLabel } from '@/lib/display-labels';
import { passingChoicesFor, suggestedPassingGrade } from '@/lib/grading-scale';

const outcomes = { suggest_b: 'Suggested grade: B', suggest_pass: 'Suggested grade: Pass', review_for_redo: 'Review for Redo', no_suggestion: 'No grade suggested', stale_evidence: 'Out of date' };
const deliveryLabels = { pending: 'Waiting to post', delivered: 'Posted to GitHub', failed: 'Could not post to GitHub', obsolete: 'Replaced by a newer review' };

export function GithubReviewCards({ submission, retry, gradingScale, selectedGrade, onSelectSuggested, disabled = false }: {
  submission: Submission;
  /** The curriculum's current scale: a suggested grade off it (B on Pass / Redo) is out of date. */
  gradingScale?: string | null;
  retry: () => Promise<void>;
  selectedGrade?: string | null;
  /** Chooses the suggested passing grade (B or Pass) without saving it. */
  onSelectSuggested?: (grade: 'B' | 'P') => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const retryMutation = useMutation({ mutationFn: retry, onError: () => Alert.alert('Could not retry GitHub delivery', 'Try again in a moment.') });
  const suggestion = submission.grade_suggestion;
  const delivery = submission.github_issue_delivery;
  const issue = githubIssueUrl(delivery?.issue_url || submission.github_issue_url);
  const passing = suggestedPassingGrade(suggestion?.outcome);
  const offScale = Boolean(passing && !passingChoicesFor(gradingScale ?? submission.grading_scale).includes(passing));
  const outdated = suggestion?.stale || suggestion?.stale_for_current_policy || suggestion?.outcome === 'stale_evidence' || offScale;
  const suggested = outdated ? null : passing;

  return <>
    {suggestion && <LearningCard><SectionHeading title="Actualize grade suggestion" /><Text style={{ color: colors.text.strong }}>{outdated ? 'Out of date' : outcomes[suggestion.outcome]}</Text><Text style={{ color: colors.text.body }}>{outdated ? 'Check GitHub again before using this suggestion.' : 'Review the work before choosing a grade.'}</Text>{suggested && onSelectSuggested && <Button variant={selectedGrade === suggested ? 'primary' : 'secondary'} accessibilityState={{ selected: selectedGrade === suggested, disabled }} disabled={disabled} label={`Select ${gradeLabel(suggested)}`} onPress={() => onSelectSuggested(suggested)} />}</LearningCard>}
    {(delivery || issue) && <LearningCard><SectionHeading title="GitHub issue delivery" /><Text style={{ color: colors.text.body }}>{delivery ? delivery.status === 'delivered' && delivery.action === 'close' ? 'Issue closed on GitHub' : deliveryLabels[delivery.status] : 'Feedback issue available'}</Text>{issue && <Button variant="secondary" label="View GitHub issue" onPress={() => void openExternalPage(issue).catch(() => Alert.alert('Could not open GitHub issue'))} />}{delivery?.status === 'failed' && <Button label="Retry GitHub delivery" disabled={retryMutation.isPending} onPress={() => retryMutation.mutate()} />}</LearningCard>}
  </>;
}
