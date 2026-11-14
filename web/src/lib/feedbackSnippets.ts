import { trimBlankLines } from './messageFormat'

/**
 * Adds a saved snippet to the feedback draft after a blank line. Only blank
 * lines at either end are dropped, so indented code (`    puts 1`) at the
 * start of either text keeps its indentation.
 */
export function appendFeedbackSnippet(current: string, snippet: string) {
  return [trimBlankLines(current), trimBlankLines(snippet)].filter(Boolean).join('\n\n')
}
