import { AuthoredContent } from './authored-content';

interface LessonMarkdownProps {
  body: string;
}

export function LessonMarkdown({ body }: LessonMarkdownProps) {
  return <AuthoredContent body={body} />;
}
