/** Prefer the API's contextual resolution. Infer only for older payloads. */
export function effectiveSubmissionType(block: { effective_submission_type?: string | null; submission_type?: string | null; block_type: string }, requiresGithub = false, requiresSubmission = block.block_type === 'exercise' || block.block_type === 'code_challenge') {
  return block.effective_submission_type || block.submission_type || (requiresSubmission ? (requiresGithub ? 'prework_github_sync' : 'text_submission') : 'manual_complete');
}
