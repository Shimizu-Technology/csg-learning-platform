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

it.each(['\n  Keep trailing spaces.  \n\n', '# Heading\r\n\r\nBody\r\n', '<div>HTML</div>\n\nMarkdown &nbsp; chap\\_01\n'])('preserves source boundaries: %j', (body) => {
  const lesson = lessonWithBody(body);
  expect(lessonEditorInput(lesson, fieldsForLesson(lesson), lesson.updated_at!).exercise?.body).toBe(body);
});

it('sends null for whitespace-only instructions and previews no padded body', () => {
  const lesson = lessonWithBody(' \t\r\n ');
  const fields = fieldsForLesson(lesson);
  expect(lessonEditorInput(lesson, fields, lesson.updated_at!).exercise?.body).toBeNull();
  expect(lessonPreviewForFields(lesson, fields).content_blocks[0].body).toBeNull();
});

const adversarialBodies = [
  '<div class="trix-content"><div>Original paragraph.</div><div><strong>Keep</strong> &nbsp; this.</div></div>',
  '<p>Original paragraph.</p>\n<!--keep comment--><pre><code>&lt;div&gt;code&lt;/div&gt;\n  indent</code></pre><p style="color:red" onclick="steal()">Keep &amp; this.</p><script>steal()</script>',
  '\uFEFF\r\n\r\nOriginal paragraph.  \r\n\r\nKeep &nbsp; &amp; 🌺.  \r\n\r\n```html\r\n<div onclick="example()">Example</div>\r\n```\r\n\r\n',
];
const jsonRoundTrip = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

describe.each(adversarialBodies)('HTML/Trix and adversarial source %j', (body) => {
  it.each(['none', 'title', 'paragraph'])('preserves the JSON payload and unrelated HTML blocks for %s edits', (edit) => {
    const otherBlocks = [
      { ...exercise, id: 981, block_type: 'text' as const, body: '<div class="trix-content">Other text</div>' },
      { ...exercise, id: 982, body: '<p onclick="keep()">Other exercise</p><!--exact-->' },
    ];
    const lesson = jsonRoundTrip({ ...lessonWithBody(body), content_blocks: [...lessonWithBody(body).content_blocks, ...otherBlocks] });
    const fields = fieldsForLesson(lesson);
    if (edit === 'title') fields.title = 'Only a title edit';
    if (edit === 'paragraph') fields.instructions = body.replace('Original paragraph.', 'Edited paragraph.');
    const expected = edit === 'paragraph' ? body.replace('Original paragraph.', 'Edited paragraph.') : body;
    const input = jsonRoundTrip(lessonEditorInput(lesson, fields, lesson.updated_at!));
    expect(input.exercise?.body).toBe(expected);
    expect(input.exercise?.id).toBe(exercise.id);
    expect(JSON.stringify(input)).not.toContain('Other text');
    expect(JSON.stringify(input)).not.toContain('Other exercise');
    const saved = jsonRoundTrip(lessonForEditorInput(lesson, input));
    expect(fieldsForLesson(saved).instructions).toBe(expected);
    expect(saved.content_blocks.slice(1)).toEqual(otherBlocks);
    expect(lesson.content_blocks.slice(1)).toEqual(otherBlocks);
  });
});
