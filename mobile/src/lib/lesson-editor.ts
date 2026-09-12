import type { LessonContentBlock, LessonDetail, LessonEditorInput, LessonSubmissionType } from './types';

export interface LessonEditorFields {
  title: string;
  required: boolean;
  video_url: string;
  filename: string;
  instructions: string;
  solution: string;
  submission_type: LessonSubmissionType;
}

export const lessonSubmissionOptions: { value: LessonSubmissionType; label: string; description: string }[] = [
  { value: 'manual_complete', label: 'Practice', description: 'Students mark the exercise complete themselves.' },
  { value: 'text_submission', label: 'Text or code', description: 'Students submit text or code directly for review.' },
  { value: 'prework_github_sync', label: 'GitHub sync', description: 'Match student work through the prework filename.' },
  { value: 'repo_url_submission', label: 'Repository', description: 'Students submit a repository URL and optional notes.' },
  { value: 'repo_and_live_url_submission', label: 'Repo + live', description: 'Students submit both repository and deployed URLs.' },
];

function editorBlock(lesson: LessonDetail, types: string[]) {
  return lesson.content_blocks.find((block) => types.includes(block.block_type));
}

export function fieldsForLesson(lesson: LessonDetail): LessonEditorFields {
  const video = editorBlock(lesson, ['video', 'recording']);
  const exercise = editorBlock(lesson, ['exercise', 'code_challenge']);
  const submissionType = exercise?.submission_type_explicit || exercise?.submission_type || lesson.submission_type || (lesson.requires_submission ? 'text_submission' : 'manual_complete');
  return {
    title: lesson.title || '',
    required: lesson.required !== false,
    video_url: video?.video_url || '',
    filename: exercise?.filename || '',
    instructions: exercise?.body || '',
    solution: exercise?.solution || '',
    submission_type: lessonSubmissionOptions.some((option) => option.value === submissionType) ? submissionType as LessonSubmissionType : 'manual_complete',
  };
}

export function lessonEditorFieldsMatch(left: LessonEditorFields, right: LessonEditorFields) {
  return left.title === right.title
    && left.required === right.required
    && left.video_url === right.video_url
    && left.filename === right.filename
    && left.instructions === right.instructions
    && left.solution === right.solution
    && left.submission_type === right.submission_type;
}

export function lessonEditorValidation(fields: LessonEditorFields) {
  if (!fields.title.trim()) return 'Add a lesson title before saving.';
  if (fields.video_url.trim()) {
    try {
      const url = new URL(fields.video_url.trim());
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return 'Video link must be a valid http or https URL.';
    } catch {
      return 'Video link must be a valid http or https URL.';
    }
  }
  if (fields.solution.trim() && !fields.instructions.trim() && !fields.filename.trim()) return 'Add instructions or a filename before adding an instructor solution.';
  return null;
}

export function lessonEditorInput(lesson: LessonDetail, fields: LessonEditorFields, baseUpdatedAt: string): LessonEditorInput {
  const title = fields.title.trim();
  const video = editorBlock(lesson, ['video', 'recording']);
  const exercise = editorBlock(lesson, ['exercise', 'code_challenge']);
  const includeVideo = Boolean(video || fields.video_url.trim());
  const includeExercise = Boolean(exercise || fields.instructions.trim() || fields.filename.trim());
  return {
    base_updated_at: baseUpdatedAt,
    title,
    required: fields.required,
    requires_submission: fields.submission_type !== 'manual_complete',
    ...(includeVideo ? { video: {
      ...(video ? { id: video.id } : {}),
      title,
      video_url: fields.video_url.trim() || null,
      ...(video?.s3_video_key !== undefined ? { s3_video_key: video.s3_video_key } : {}),
    } } : {}),
    ...(includeExercise ? { exercise: {
      ...(exercise ? { id: exercise.id } : {}),
      title,
      body: fields.instructions.trim() || null,
      solution: fields.solution.trim() || null,
      filename: fields.filename.trim() || null,
      submission_type: fields.submission_type,
      submission_config: exercise?.submission_config || {},
      rubric_id: exercise?.rubric?.id || null,
    } } : {}),
    alignments: (lesson.objectives || []).map((objective) => ({
      learning_objective_id: objective.id,
      content_block_id: objective.content_block_id,
    })),
  };
}

function previewBlock(block: LessonContentBlock, fields: LessonEditorFields) {
  if (['video', 'recording'].includes(block.block_type)) return { ...block, title: fields.title.trim(), video_url: fields.video_url.trim() || null };
  if (['exercise', 'code_challenge'].includes(block.block_type)) return { ...block, title: fields.title.trim(), body: fields.instructions.trim() || null, solution: fields.solution.trim() || null, filename: fields.filename.trim() || null, submission_type: fields.submission_type };
  return block;
}

export function lessonPreviewForFields(lesson: LessonDetail, fields: LessonEditorFields): LessonDetail {
  const blocks = lesson.content_blocks.map((block) => previewBlock(block, fields));
  if (!editorBlock(lesson, ['video', 'recording']) && fields.video_url.trim()) blocks.push({ id: -1, block_type: 'video', position: blocks.length + 1, title: fields.title.trim(), body: null, video_url: fields.video_url.trim(), filename: null, metadata: {} });
  if (!editorBlock(lesson, ['exercise', 'code_challenge']) && (fields.instructions.trim() || fields.filename.trim())) blocks.push({ id: -2, block_type: 'exercise', position: blocks.length + 1, title: fields.title.trim(), body: fields.instructions.trim() || null, solution: fields.solution.trim() || null, video_url: null, filename: fields.filename.trim() || null, submission_type: fields.submission_type, metadata: {} });
  return { ...lesson, title: fields.title.trim() || 'Untitled lesson', required: fields.required, requires_submission: fields.submission_type !== 'manual_complete', submission_type: fields.submission_type, content_blocks_count: blocks.length, content_blocks: blocks };
}

export function lessonForEditorInput(lesson: LessonDetail, input: LessonEditorInput, updatedAt = new Date().toISOString()): LessonDetail {
  const blocks = lesson.content_blocks.map((block) => {
    if (input.video?.id === block.id) return { ...block, title: input.video.title, video_url: input.video.video_url, ...(input.video.s3_video_key !== undefined ? { s3_video_key: input.video.s3_video_key } : {}) };
    if (input.exercise?.id === block.id) return { ...block, title: input.exercise.title, body: input.exercise.body, solution: input.exercise.solution, filename: input.exercise.filename, submission_type: input.exercise.submission_type, submission_type_explicit: input.exercise.submission_type, submission_config: input.exercise.submission_config };
    return block;
  });
  if (input.video && input.video.id === undefined) blocks.push({ id: -1, block_type: 'video', position: blocks.length + 1, title: input.video.title, body: null, video_url: input.video.video_url, s3_video_key: input.video.s3_video_key, filename: null, metadata: {} });
  if (input.exercise && input.exercise.id === undefined) blocks.push({ id: -2, block_type: 'exercise', position: blocks.length + 1, title: input.exercise.title, body: input.exercise.body, solution: input.exercise.solution, video_url: null, filename: input.exercise.filename, submission_type: input.exercise.submission_type, submission_type_explicit: input.exercise.submission_type, submission_config: input.exercise.submission_config, metadata: {} });
  return { ...lesson, title: input.title, required: input.required, requires_submission: input.requires_submission, submission_type: input.exercise?.submission_type || lesson.submission_type, updated_at: updatedAt, content_blocks_count: blocks.length, content_blocks: blocks };
}
