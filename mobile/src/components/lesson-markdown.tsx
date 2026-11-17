import { AuthoredContent, type StarterLinkContext } from './authored-content';

interface LessonMarkdownProps {
  body: string;
  starterLinks?: StarterLinkContext;
}

/** Maintains the lesson-facing API while sharing the HTML and Markdown renderer. */
export function LessonMarkdown({ body, starterLinks }: LessonMarkdownProps) {
  return <AuthoredContent body={body} starterLinks={starterLinks} />;
}
