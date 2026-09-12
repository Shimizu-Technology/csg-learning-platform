import { demoLesson } from '../demo-learning';
import { fieldsForLesson, lessonEditorFieldsMatch, lessonEditorInput, lessonEditorValidation, lessonForEditorInput, lessonPreviewForFields } from '../lesson-editor';
import type { LessonDetail } from '../types';

const lesson: LessonDetail = {
  ...demoLesson,
  objectives: [{ alignment_id: 4, id: 9, code: 'CSS-1', title: 'Build layouts', description: null, success_criteria: 'Uses Grid', active: true, content_block_id: 203, content_block_title: 'Rebuild the card grid' }],
  content_blocks: demoLesson.content_blocks.map((block) => block.id === 203 ? { ...block, submission_type_explicit: 'text_submission', submission_config: { runner: { enabled: true } }, rubric: { id: 12, title: 'Layout rubric', description: null, criteria: [] } } : block).concat({ id: 204, block_type: 'video', position: 0, title: 'Responsive layouts with Grid', body: null, video_url: 'https://video.example.com/grid', s3_video_key: 'content_videos/grid.mp4', s3_video_content_type: 'video/mp4', s3_video_size: 4096, filename: null, metadata: {} }),
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
      video: { id: 204, s3_video_key: 'content_videos/grid.mp4', s3_video_content_type: 'video/mp4', s3_video_size: 4096 },
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

  it('requires an exercise before attaching a rubric', () => {
    const fields = { ...fieldsForLesson({ ...lesson, content_blocks: lesson.content_blocks.filter((block) => block.id !== 203) }), rubric_id: 12 };

    expect(lessonEditorValidation(fields)).toMatch(/exercise/i);
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

  it('stages a replacement upload without pretending the unsaved file can stream', () => {
    const fields = { ...fieldsForLesson(lesson), video_url: '', s3_video_key: 'content_videos/new-grid.mov', s3_video_content_type: 'video/quicktime', s3_video_size: 8192 };
    const preview = lessonPreviewForFields(lesson, fields);
    const video = preview.content_blocks.find((block) => block.id === 204);

    expect(video).toMatchObject({ s3_video_key: 'content_videos/new-grid.mov', s3_video_content_type: 'video/quicktime', s3_video_size: 8192, has_s3_video: false, metadata: { staged_video_upload: true } });
    const saved = lessonForEditorInput(lesson, lessonEditorInput(lesson, fields, lesson.updated_at!));
    expect(fieldsForLesson(saved)).toEqual(fields);
    expect(saved.content_blocks.find((block) => block.id === 204)).toMatchObject({ has_s3_video: true, metadata: {} });
  });

  it('edits only the selected exercise when a lesson has multiple exercise blocks', () => {
    const secondExercise = { ...lesson.content_blocks.find((block) => block.id === 203)!, id: 205, position: 4, title: 'Second exercise', body: 'Keep this body.', submission_type: 'manual_complete' as const, submission_type_explicit: 'manual_complete' as const };
    const multiExerciseLesson: LessonDetail = { ...lesson, objectives: [...lesson.objectives!, { ...lesson.objectives![0], alignment_id: 5, content_block_id: 205, content_block_title: 'Second exercise' }], content_blocks: [...lesson.content_blocks, secondExercise] };
    const fields = { ...fieldsForLesson(multiExerciseLesson), title: 'Edited lesson', instructions: 'Edit only the primary exercise.', submission_type: 'repo_url_submission' as const };

    const preview = lessonPreviewForFields(multiExerciseLesson, fields);

    expect(preview.content_blocks.find((block) => block.id === 203)).toMatchObject({ title: 'Edited lesson', body: 'Edit only the primary exercise.', submission_type: 'repo_url_submission', submission_type_explicit: 'repo_url_submission' });
    expect(preview.content_blocks.find((block) => block.id === 205)).toMatchObject({ title: 'Second exercise', body: 'Keep this body.', submission_type: 'manual_complete', submission_type_explicit: 'manual_complete' });
    expect(preview.objectives?.find((objective) => objective.content_block_id === 205)?.content_block_title).toBe('Second exercise');
  });

  it('keeps an objective at lesson level when its retrieval-check target is disabled', () => {
    const checkObjectiveLesson: LessonDetail = { ...lesson, objectives: [{ ...lesson.objectives![0], content_block_id: 202, content_block_title: 'Quick layout recall' }] };
    const fields = fieldsForLesson(checkObjectiveLesson);
    fields.objective_alignments = [{ learning_objective_id: 9, content_block_id: 202 }];
    fields.retrieval_check = { ...fields.retrieval_check, enabled: false };

    expect(lessonEditorInput(checkObjectiveLesson, fields, checkObjectiveLesson.updated_at!).alignments).toEqual([{ learning_objective_id: 9, content_block_id: null }]);
    expect(lessonPreviewForFields(checkObjectiveLesson, fields).objectives).toEqual([expect.objectContaining({ id: 9, content_block_id: null, content_block_title: null })]);
  });

  it('omits an immutable attempted check when saving other lesson changes', () => {
    const fields = fieldsForLesson(lesson);
    fields.title = 'Updated lesson title';
    fields.retrieval_check = { ...fields.retrieval_check, attempt_count: 3 };

    expect(lessonEditorInput(lesson, fields, lesson.updated_at!)).not.toHaveProperty('retrieval_check');
  });
});
