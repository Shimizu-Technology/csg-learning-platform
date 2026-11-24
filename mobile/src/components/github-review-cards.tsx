import { useMutation } from '@tanstack/react-query';
import { Text } from 'react-native';
import { LearningCard, SectionHeading } from './learning-ui';
import { Button } from './ui/button';
import { useTheme } from '@/providers/theme-provider';
import { githubIssueUrl, openExternalPage } from '@/lib/external-links';
import { themedAlert as Alert } from '@/lib/alerts';
import type { Submission } from '@/lib/types';

const outcomes = { suggest_b: 'Suggested grade: B', review_for_redo: 'Review for Redo', no_suggestion: 'No grade suggested', stale_evidence: 'Out of date' };
const deliveryLabels = { pending: 'Waiting to post', delivered: 'Posted to GitHub', failed: 'Could not post to GitHub', obsolete: 'Replaced by a newer review' };

export function GithubReviewCards({ submission, retry }: { submission: Submission; retry: () => Promise<void> }) {
  const { colors } = useTheme();
  const retryMutation = useMutation({ mutationFn: retry, onError: () => Alert.alert('Could not retry GitHub delivery', 'Try again in a moment.') });
  const suggestion = submission.grade_suggestion;
  const delivery = submission.github_issue_delivery;
  const issue = githubIssueUrl(delivery?.issue_url || submission.github_issue_url);
  const outdated = suggestion?.stale || suggestion?.stale_for_current_policy || suggestion?.outcome === 'stale_evidence';

  return <>
    {suggestion && <LearningCard><SectionHeading title="Actualize grade suggestion" /><Text style={{ color: colors.text.strong }}>{outdated ? 'Out of date' : outcomes[suggestion.outcome]}</Text><Text style={{ color: colors.text.body }}>{outdated ? 'Check GitHub again before using this suggestion.' : 'Review the work before choosing a grade.'}</Text></LearningCard>}
    {(delivery || issue) && <LearningCard><SectionHeading title="GitHub issue delivery" /><Text style={{ color: colors.text.body }}>{delivery ? delivery.status === 'delivered' && delivery.action === 'close' ? 'Issue closed on GitHub' : deliveryLabels[delivery.status] : 'Feedback issue available'}</Text>{issue && <Button variant="secondary" label="View GitHub issue" onPress={() => void openExternalPage(issue).catch(() => Alert.alert('Could not open GitHub issue'))} />}{delivery?.status === 'failed' && <Button label="Retry GitHub delivery" disabled={retryMutation.isPending} onPress={() => retryMutation.mutate()} />}</LearningCard>}
  </>;
}
