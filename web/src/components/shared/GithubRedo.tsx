export function githubRedoInstruction(filename?: string | null, repository?: string | null) {
  return `Redo requested. Fix ${filename || 'your exercise'}, then commit and push again${repository ? ` to ${repository}` : ''}. Your new attempt appears here within an hour.`
}

export function GithubRedoIssue({ url }: { url?: string | null }) {
  if (!url || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+\/?$/i.test(url)) return null
  return <a href={url} target="_blank" rel="noopener noreferrer" className="app-link inline-flex min-h-11 items-center">Read feedback on GitHub<span className="sr-only"> (opens in a new tab)</span></a>
}
