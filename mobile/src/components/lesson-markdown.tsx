import { AuthoredContent } from './authored-content';

interface LessonMarkdownProps {
  body: string;
}

/** Maintains the lesson-facing API while sharing the HTML and Markdown renderer. */
export function LessonMarkdown({ body }: LessonMarkdownProps) {
  return <AuthoredContent body={body} />;
}
