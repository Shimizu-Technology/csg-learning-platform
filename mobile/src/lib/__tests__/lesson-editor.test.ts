import { demoLesson } from '../demo-learning';
import { fieldsForLesson, lessonEditorFieldsMatch, lessonEditorInput, lessonEditorValidation, lessonForEditorInput, lessonPreviewForFields } from '../lesson-editor';
import type { LessonDetail } from '../types';

const lesson: LessonDetail = {
  ...demoLesson,
  objectives: [{ alignment_id: 4, id: 9, code: 'CSS-1', title: 'Build layouts', description: null, success_criteria: 'Uses Grid', active: true, content_block_id: 203, content_block_title: 'Rebuild the card grid' }],
  content_blocks: demoLesson.content_blocks.map((block) => block.id === 203 ? { ...block, submission_type_explicit: 'text_submission', submission_config: { runner: { enabled: true } }, rubric: { id: 12, title: 'Layout rubric', description: null, criteria: [] } } : block).concat({ id: 204, block_type: 'video', position: 0, title: 'Responsive layouts with Grid', body: null, video_url: 'https://video.example.com/grid', s3_video_key: 'lessons/grid.mp4', filename: null, metadata: {} }),
};

describe('lesson editor helpers', () => {
  it('builds a complete atomic payload without dropping hidden relationships', () => {
    const fields = { ...fieldsForLesson(lesson), title: ' Responsive Grid ', instructions: ' Build a responsive grid. ', solution: ' Use minmax(). ' };
    const input = lessonEditorInput(lesson, fields, lesson.updated_at!);

    expect(input).toMatchObject({
      base_updated_at: lesson.updated_at,
      title: 'Responsive Grid',
      required: true,
      requires_submission: true,
      video: { id: 204, s3_video_key: 'lessons/grid.mp4' },
      exercise: { id: 203, body: 'Build a responsive grid.', solution: 'Use minmax().', submission_config: { runner: { enabled: true } }, rubric_id: 12 },
      alignments: [{ learning_objective_id: 9, content_block_id: 203 }],
    });
  });

  it('validates title, video URL, and orphaned solutions before a request', () => {
    const fields = fieldsForLesson(lesson);
    expect(lessonEditorValidation({ ...fields, title: ' ' })).toMatch(/title/i);
    expect(lessonEditorValidation({ ...fields, video_url: 'javascript:alert(1)' })).toMatch(/http/i);
    expect(lessonEditorValidation({ ...fields, instructions: '', filename: '', solution: 'Answer' })).toMatch(/instructions/i);
    expect(lessonEditorValidation(fields)).toBeNull();
  });

  it('previews unsaved fields and applies a saved editor response locally', () => {
    const fields = { ...fieldsForLesson(lesson), title: 'Grid systems', required: false, instructions: 'Build two layouts.' };
    const preview = lessonPreviewForFields(lesson, fields);
    const saved = lessonForEditorInput(lesson, lessonEditorInput(lesson, fields, lesson.updated_at!), '2026-09-12T02:00:00Z');

    expect(preview).toMatchObject({ title: 'Grid systems', required: false });
    expect(preview.content_blocks.find((block) => block.id === 203)?.body).toBe('Build two layouts.');
    expect(fieldsForLesson(saved)).toEqual(fields);
    expect(lessonEditorFieldsMatch(fieldsForLesson(saved), fields)).toBe(true);
    expect(saved.updated_at).toBe('2026-09-12T02:00:00Z');
  });
});
