import { CheckCircle2, ChevronDown, ChevronUp, Code, History, Lock, Send } from 'lucide-react'
import { CODE_RUNNER_TIMEOUT_MS } from '../../lib/codeRunner'
import { formatShortDate, formatShortDateTime } from '../../lib/format'
import { reviewTiming } from '../../lib/reviewCopy'
import { Button } from '../ui/Button'
import { CodeBlock } from './CodeBlock'
import { CodeEditor } from './CodeEditor'
import { CodeRunner } from './CodeRunner'
import type { ContentBlockRendererProps } from './contentBlockTypes'
import { FeedbackBody } from './FeedbackBody'
import { LazyMarkdownEditor } from './LazyMarkdownEditor'
import { MarkdownRenderer } from './MarkdownRenderer'
import type { ContentBlockController } from './useContentBlockController'

export function SubmissionBlock({ controller, ...props }: ContentBlockRendererProps & { controller: ContentBlockController }) {
  const { v2, touch, setRevisionOpen, reviewResponseTime, submissions, latestSubmission, hasRedoRequest, canEditSubmission, submissionText, setSubmissionText, repoUrl, setRepoUrl, prUrl, setPrUrl, liveUrl, setLiveUrl, branchName, setBranchName, commitSha, setCommitSha, submissionNotes, setSubmissionNotes, showAdvancedRepoFields, setShowAdvancedRepoFields, isSubmitting, isSubmissionCheckpoint, isWorkBlock, detectedLang, runnerConfig, writtenSubmission, submissionType, usesGithubSyncSubmission, usesTextSubmission, usesRepoArtifactSubmission, requiresLiveUrl, workLocked, latestStatus, editAnswer, lockCopy, handleDraftChange, handleSubmit, submissionArtifacts, submissionStatusMessage } = controller
  const { block, isStaff, repositoryName, readOnly, submissionsCloseAt, reviewerName } = props
  return <>
        {!isStaff && ((isWorkBlock && submissionType !== 'manual_complete') || submissions.some((submission) => submission.grade)) && (
          <div className="mt-4 space-y-3">
            {workLocked && (
              <div className="rounded-xl border border-line bg-surface-sunken/60 px-4 py-3">
                <div className="flex items-start gap-2">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold text-ink">{lockCopy}</p>
                    <p className="mt-1 text-sm leading-6 text-ink-secondary">
                      {readOnly ? 'Existing submissions and feedback remain visible. This course is available for review only.' : `Closed ${formatShortDateTime(submissionsCloseAt, 'the close time')}. Existing submissions and feedback remain visible, but new submissions and redo resubmissions are disabled.`}
                    </p>
                  </div>
                </div>
              </div>
            )}
            {latestStatus === 'awaiting_review' && (
              <div className={v2 ? 'flex items-start gap-2 rounded-xl border border-success-line bg-success-soft px-4 py-3 text-sm text-success-ink' : 'flex items-start gap-2 rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-secondary'} role="status">
                {v2 ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                <p><span className="font-semibold">{v2 ? 'Waiting for review.' : 'Submitted · waiting for review.'}</span> {v2 && reviewerName ? reviewerName : 'Your instructor'} will review it — {reviewTiming(reviewResponseTime)}. Feedback will appear here.{!workLocked && (usesTextSubmission || usesRepoArtifactSubmission) && ' You can still update this submission before they review it.'}</p>
              </div>
            )}
            {v2 && submissions.length > 0 && <div className="min-w-0 space-y-2">{submissions.map((sub, index) => <details key={sub.id} className="min-w-0 rounded-xl border border-line bg-surface-raised">
              <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold text-ink">View submission #{sub.num_submissions}</summary>
              <div className="min-w-0 space-y-3 px-4 pb-4">{sub.text && (writtenSubmission ? <MarkdownRenderer content={sub.text} variant="written" /> : <CodeBlock code={sub.text} language={detectedLang} surface="submission" lineNumbers className="my-0" />)}{submissionArtifacts(sub)}{index > 0 && sub.feedback && <FeedbackBody feedback={sub.feedback} />}</div>
            </details>)}{canEditSubmission && !workLocked && !editAnswer && (usesTextSubmission || usesRepoArtifactSubmission) && <Button variant="secondary" onClick={() => setRevisionOpen(true)}>Edit and resubmit</Button>}</div>}
            {!v2 && block.submissions && block.submissions.some((sub) => submissionType !== 'manual_complete' || sub.text || sub.repo_url || sub.live_url || sub.pr_url || sub.github_code_url || sub.notes) && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-ink">
                  {block.submissions.length === 1 ? 'Your submission' : <>Your submissions <span className="font-normal tabular-nums text-ink-muted">({block.submissions.length})</span></>}
                </h3>
                {block.submissions.map((sub, idx) => {
                  const isLatest = idx === 0
                  const isRedo = sub.grade === 'R'
                  const isGraded = sub.grade !== null
                  return (
                    <div
                      key={sub.id}
                      className={`rounded-xl border border-line p-4 ${isLatest ? 'bg-surface-raised' : 'bg-surface-sunken/60'}`}
                    >
                      <p className="mb-3 text-xs text-ink-muted">
                        <span className="font-semibold text-ink-secondary tabular-nums">Submission #{sub.num_submissions}</span>
                        {' · '}<span className="tabular-nums">{formatShortDate(sub.created_at)}</span>
                        {' · '}{isLatest ? 'Latest' : 'Earlier'}
                        {isGraded && <>{' · '}{isRedo ? 'Redo requested' : `Grade ${sub.grade}`}</>}
                      </p>

                      <div className="mt-2">
                        {sub.text ? (
                          <CodeBlock code={sub.text} language={detectedLang} surface="submission" lineNumbers className="my-0" />
                        ) : (
                          <div className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink-muted">
                            No inline code text submitted.
                          </div>
                        )}
                      </div>

                      {submissionArtifacts(sub)}

                      {/* The latest feedback is shown once, in the card above. */}
                      {!isLatest && isGraded && (sub.feedback || isRedo) && (
                        <div className="mt-3 rounded-lg border border-line bg-surface-raised p-3">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-ink-secondary">
                              {isRedo ? 'Earlier feedback · redo requested' : 'Earlier feedback'}
                            </p>
                            {sub.graded_at && (
                              <p className="text-xs tabular-nums text-ink-muted">
                                {formatShortDate(sub.graded_at)}
                              </p>
                            )}
                          </div>
                          {sub.feedback ? (
                            <FeedbackBody feedback={sub.feedback} />
                          ) : (
                            <p className="text-sm italic text-ink-muted">No written feedback.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {readOnly ? <p className="text-sm text-ink-secondary">Your submitted work and feedback remain available above.</p> : usesGithubSyncSubmission ? (
              <div className="space-y-2 rounded-xl border border-line bg-surface-sunken/60 p-4">
                <p className="text-sm font-semibold text-ink">Submit via GitHub</p>
                <p className="text-sm text-ink-secondary">
                  Complete this exercise in your local environment{block.filename ? ` in the file ${block.filename}` : ''}, then push your changes to your{' '}
                  <span className="font-semibold text-ink">{repositoryName || 'exercises'}</span> repository on GitHub.
                </p>
                <p className="text-sm text-ink-muted">
                  {workLocked ? (readOnly ? 'This lesson is available for review. GitHub sync is disabled.' : 'GitHub sync is disabled after the submission window closes.') : 'Your instructor will sync and review your code from GitHub.'}
                </p>
              </div>
            ) : submissionType === 'manual_complete' ? null : !canEditSubmission ? (
              <p className="text-sm text-ink-secondary">Review complete. You can inspect your submitted work and feedback above.</p>
            ) : !editAnswer ? null : usesTextSubmission ? (
              <div className="space-y-3 rounded-xl border border-line bg-surface-sunken/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">
                    {hasRedoRequest ? 'Revise and resubmit' : block.submissions && block.submissions.length > 0 ? 'Revise your answer' : 'Write your solution'}
                  </h3>
                  {block.filename && (
                    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-line/60 px-2 py-1 font-mono text-xs text-ink-secondary [overflow-wrap:anywhere]">
                      <Code className="h-3 w-3 shrink-0" aria-hidden="true" />
                      {block.filename}
                    </span>
                  )}
                </div>
                {writtenSubmission ? (
                  <LazyMarkdownEditor
                    label="Your answer"
                    value={submissionText}
                    onChange={(value) => handleDraftChange(() => setSubmissionText(value))}
                    placeholder="Write your answer"
                    // Freeze the draft while it is being sent so a later edit can't be dropped on success.
                    disabled={workLocked || isSubmitting}
                    minHeight={200}
                    maxHeight={560}
                  />
                ) : v2 && touch ? (
                  <label className="block text-sm font-semibold text-ink">Your code<textarea aria-label="Your code" value={submissionText} onChange={(event) => handleDraftChange(() => setSubmissionText(event.target.value))} disabled={workLocked || isSubmitting} autoCapitalize="off" autoCorrect="off" spellCheck={false} wrap="off" className="mt-2 min-h-60 w-full min-w-0 overflow-x-auto rounded-xl border border-code-line bg-code-bg p-3 font-mono text-base leading-relaxed text-code-ink" /></label>
                ) : (
                  <CodeEditor
                    value={submissionText}
                    onChange={(value) => handleDraftChange(() => setSubmissionText(value))}
                    language={detectedLang}
                    minHeight={240}
                    wordWrap={v2 ? 'off' : 'on'}
                    readOnly={workLocked}
                    // Freeze the draft while it is being sent so a later edit can't be dropped on success.
                    busy={isSubmitting}
                    showKeyboardHelp
                  />
                )}
                {runnerConfig.enabled && (
                  <CodeRunner
                    code={submissionText}
                    language={runnerConfig.language}
                    timeoutMs={CODE_RUNNER_TIMEOUT_MS}
                  />
                )}
                {submissionStatusMessage}
                <div className="flex items-center justify-end">
                  <Button
                    onClick={() => void handleSubmit()}
                    disabled={workLocked || isSubmitting || !submissionText.trim()}
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    {workLocked ? 'Closed' : isSubmitting ? 'Submitting…' : latestSubmission ? (hasRedoRequest ? (isSubmissionCheckpoint ? 'Resubmit checkpoint' : 'Resubmit') : 'Update submission') : (isSubmissionCheckpoint ? 'Submit checkpoint' : 'Submit')}
                  </Button>
                </div>
              </div>
            ) : usesRepoArtifactSubmission ? (
              <div className="space-y-3 rounded-xl border border-line bg-surface-sunken/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink">
                    {hasRedoRequest ? 'Revise and resubmit' : latestSubmission ? 'Update submission' : 'Submit project'}
                  </h3>
                  <span className="text-xs text-ink-muted">
                    {requiresLiveUrl ? 'Repo + live URL required' : 'Repository URL required'}
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-ink-secondary">Repository URL</span>
                    <input
                      value={repoUrl}
                      onChange={(e) => handleDraftChange(() => setRepoUrl(e.target.value))}
                      disabled={workLocked || isSubmitting}
                      placeholder="https://github.com/username/project"
                      className="app-control w-full"
                    />
                  </label>
                  {requiresLiveUrl && (
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-ink-secondary">Live URL</span>
                      <input
                        value={liveUrl}
                        onChange={(e) => handleDraftChange(() => setLiveUrl(e.target.value))}
                        disabled={workLocked || isSubmitting}
                        placeholder="https://your-app.example.com"
                        className="app-control w-full"
                      />
                    </label>
                  )}
                </div>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-ink-secondary">Notes (optional)</span>
                  <textarea
                    value={submissionNotes}
                    onChange={(e) => handleDraftChange(() => setSubmissionNotes(e.target.value))}
                    disabled={workLocked || isSubmitting}
                    rows={4}
                    placeholder="Anything your instructor should know about this submission."
                    className="app-control w-full"
                  />
                </label>
                <div className="space-y-3">
                  <Button
                    variant="quiet"
                    size="sm"
                    aria-expanded={showAdvancedRepoFields}
                    onClick={() => setShowAdvancedRepoFields((current) => !current)}
                    className="-ml-2"
                  >
                    {showAdvancedRepoFields ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                    {showAdvancedRepoFields ? 'Hide extra Git details' : 'Add PR / branch / commit details'}
                  </Button>
                  {showAdvancedRepoFields && (
                    <div className="grid gap-3 md:grid-cols-2">
                      {!requiresLiveUrl && (
                        <label className="block">
                          <span className="mb-1 block text-sm font-medium text-ink-secondary">Live URL (optional)</span>
                          <input
                            value={liveUrl}
                            onChange={(e) => handleDraftChange(() => setLiveUrl(e.target.value))}
                            disabled={workLocked || isSubmitting}
                            placeholder="https://your-app.example.com"
                            className="app-control w-full"
                          />
                        </label>
                      )}
                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-ink-secondary">Pull request URL (optional)</span>
                        <input
                          value={prUrl}
                          onChange={(e) => handleDraftChange(() => setPrUrl(e.target.value))}
                          disabled={workLocked || isSubmitting}
                          placeholder="https://github.com/.../pull/123"
                          className="app-control w-full"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-ink-secondary">Branch (optional)</span>
                        <input
                          value={branchName}
                          onChange={(e) => handleDraftChange(() => setBranchName(e.target.value))}
                          disabled={workLocked || isSubmitting}
                          placeholder="main"
                          className="app-control w-full"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-ink-secondary">Commit SHA (optional)</span>
                        <input
                          value={commitSha}
                          onChange={(e) => handleDraftChange(() => setCommitSha(e.target.value))}
                          disabled={workLocked || isSubmitting}
                          placeholder="abc1234"
                          className="app-control w-full"
                        />
                      </label>
                    </div>
                  )}
                </div>
                {submissionStatusMessage}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-ink-muted">
                    {requiresLiveUrl
                      ? 'Share the repo and deployed app you want reviewed.'
                      : 'Share the repo you want reviewed. Notes are optional.'}
                  </p>
                  <Button
                    onClick={() => void handleSubmit()}
                    disabled={workLocked || isSubmitting || !repoUrl.trim() || (requiresLiveUrl && !liveUrl.trim())}
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                    {workLocked ? 'Closed' : isSubmitting ? 'Submitting…' : latestSubmission ? (hasRedoRequest ? 'Resubmit links' : 'Update links') : 'Submit links'}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}


  </>
}
