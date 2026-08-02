export function appendFeedbackSnippet(current: string, snippet: string) {
  return [current.trim(), snippet.trim()].filter(Boolean).join('\n\n');
}
