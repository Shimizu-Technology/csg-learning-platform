import bodies from './fixtures/prework-lesson-bodies.json';
import { demoLesson } from '../demo-learning';
import { fieldsForLesson, lessonEditorInput, lessonForEditorInput, lessonPreviewForFields } from '../lesson-editor';

// Exact fixture from PR #304 (feat/shared-editor-finish), generated with the
// prework import's html_to_markdown over scripts/prework_exercises.json.
const exercise = demoLesson.content_blocks.find((block) => block.block_type === 'exercise')!;
const lessonWithBody = (body: string) => ({ ...demoLesson, content_blocks: [{ ...exercise, body }] });

expect(bodies).toHaveLength(127);

describe.each(bodies)('$title', ({ body }) => {
  it('loads, previews, and saves the source byte for byte, including a title-only edit', () => {
    const lesson = lessonWithBody(body);
    const fields = fieldsForLesson(lesson);
    expect(fields.instructions).toBe(body);
    expect(lessonPreviewForFields(lesson, fields).content_blocks[0].body).toBe(body);
    const input = lessonEditorInput(lesson, { ...fields, title: 'Changed title' }, lesson.updated_at!);
    expect(input.exercise?.body).toBe(body);
    expect(fieldsForLesson(lessonForEditorInput(lesson, input)).instructions).toBe(body);
  });

  it('changes only the first paragraph, preserving every byte after it', () => {
    const lesson = lessonWithBody(body);
    const end = body.indexOf('\n\n');
    const paragraphEnd = end === -1 ? body.length : end;
    const edited = body.slice(0, paragraphEnd) + ' Revised instructions.' + body.slice(paragraphEnd);
    const input = lessonEditorInput(lesson, { ...fieldsForLesson(lesson), instructions: edited }, lesson.updated_at!);
    expect(input.exercise?.body).toBe(edited);
    expect(input.exercise?.body?.slice(paragraphEnd + ' Revised instructions.'.length)).toBe(body.slice(paragraphEnd));
    expect(fieldsForLesson(lessonForEditorInput(lesson, input)).instructions).toBe(edited);
  });
});

it.each(['\n  Keep trailing spaces.  \n\n', '# Heading\r\n\r\nBody\r\n', '<div>HTML</div>\n\nMarkdown &nbsp; chap\\_01\n', '   \n'])('preserves source boundaries: %j', (body) => {
  const lesson = lessonWithBody(body);
  expect(lessonEditorInput(lesson, fieldsForLesson(lesson), lesson.updated_at!).exercise?.body).toBe(body);
});
