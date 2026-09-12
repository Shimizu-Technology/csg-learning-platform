import type { LearningObjective, LessonContentBlock, LessonDetail, LessonEditorInput, LessonObjective, LessonSubmissionType, Rubric } from './types';

export interface ObjectiveAlignmentField {
  learning_objective_id: number;
  content_block_id: number | null;
}

export interface RetrievalCheckEditorFields {
  enabled: boolean;
  content_block_id?: number;
  title: string;
  prompt: string;
  options: string[];
  correct_option: number;
  explanation: string;
  learning_objective_id: number | null;
  attempt_count: number;
}

export interface LessonEditorFields {
  title: string;
  required: boolean;
  video_url: string;
  filename: string;
  instructions: string;
  solution: string;
  submission_type: LessonSubmissionType;
  objective_alignments: ObjectiveAlignmentField[];
  rubric_id: number | null;
  retrieval_check: RetrievalCheckEditorFields;
}

export const lessonSubmissionOptions: { value: LessonSubmissionType; label: string; description: string }[] = [
  { value: 'manual_complete', label: 'Practice', description: 'Students mark the exercise complete themselves.' },
  { value: 'text_submission', label: 'Text or code', description: 'Students submit text or code directly for review.' },
  { value: 'prework_github_sync', label: 'GitHub sync', description: 'Match student work through the prework filename.' },
  { value: 'repo_url_submission', label: 'Repository', description: 'Students submit a repository URL and optional notes.' },
  { value: 'repo_and_live_url_submission', label: 'Repo + live', description: 'Students submit both repository and deployed URLs.' },
];

export function emptyRetrievalCheck(): RetrievalCheckEditorFields {
  return { enabled: false, title: 'Quick check', prompt: '', options: ['', ''], correct_option: 0, explanation: '', learning_objective_id: null, attempt_count: 0 };
}

function editorBlock(lesson: LessonDetail, types: string[]) {
  return lesson.content_blocks.find((block) => types.includes(block.block_type));
}

function normalizedObjectiveAlignments(fields: LessonEditorFields) {
  const removedCheckId = fields.retrieval_check.enabled ? undefined : fields.retrieval_check.content_block_id;
  return fields.objective_alignments.map((alignment) => alignment.content_block_id === removedCheckId
    ? { ...alignment, content_block_id: null }
    : { ...alignment });
}

export function fieldsForLesson(lesson: LessonDetail): LessonEditorFields {
  const video = editorBlock(lesson, ['video', 'recording']);
  const exercise = editorBlock(lesson, ['exercise', 'code_challenge']);
  const checkBlock = lesson.content_blocks.find((block) => block.knowledge_check);
  const check = checkBlock?.knowledge_check;
  const submissionType = exercise?.submission_type_explicit || exercise?.submission_type || lesson.submission_type || (lesson.requires_submission ? 'text_submission' : 'manual_complete');
  return {
    title: lesson.title || '',
    required: lesson.required !== false,
    video_url: video?.video_url || '',
    filename: exercise?.filename || '',
    instructions: exercise?.body || '',
    solution: exercise?.solution || '',
    submission_type: lessonSubmissionOptions.some((option) => option.value === submissionType) ? submissionType as LessonSubmissionType : 'manual_complete',
    objective_alignments: (lesson.objectives || []).map((objective) => ({ learning_objective_id: objective.id, content_block_id: objective.content_block_id })),
    rubric_id: exercise?.rubric?.id || null,
    retrieval_check: check ? {
      enabled: true,
      content_block_id: checkBlock?.id,
      title: checkBlock?.title || 'Quick check',
      prompt: check.prompt,
      options: [...check.options],
      correct_option: check.correct_option ?? check.latest_attempt?.correct_option ?? 0,
      explanation: check.explanation || check.latest_attempt?.explanation || '',
      learning_objective_id: check.learning_objective_id || null,
      attempt_count: check.attempt_count,
    } : emptyRetrievalCheck(),
  };
}

export function lessonEditorFieldsMatch(left: LessonEditorFields, right: LessonEditorFields) {
  return left.title === right.title
    && left.required === right.required
    && left.video_url === right.video_url
    && left.filename === right.filename
    && left.instructions === right.instructions
    && left.solution === right.solution
    && left.submission_type === right.submission_type
    && left.rubric_id === right.rubric_id
    && JSON.stringify(left.objective_alignments) === JSON.stringify(right.objective_alignments)
    && JSON.stringify(left.retrieval_check) === JSON.stringify(right.retrieval_check);
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
  if (fields.rubric_id && !fields.instructions.trim() && !fields.filename.trim()) return 'Add exercise instructions or a filename before attaching a rubric.';
  if (fields.retrieval_check.enabled) {
    const check = fields.retrieval_check;
    const options = check.options.map((option) => option.trim());
    if (!check.prompt.trim()) return 'Add a question for the quick recall check.';
    if (options.length < 2 || options.length > 6 || options.some((option) => !option)) return 'Add 2 to 6 complete answer choices for the quick recall check.';
    if (check.correct_option < 0 || check.correct_option >= options.length) return 'Choose a valid correct answer for the quick recall check.';
    if (!check.explanation.trim()) return 'Add the explanation students see after answering the quick recall check.';
  }
  return null;
}

export function lessonEditorInput(lesson: LessonDetail, fields: LessonEditorFields, baseUpdatedAt: string): LessonEditorInput {
  const title = fields.title.trim();
  const video = editorBlock(lesson, ['video', 'recording']);
  const exercise = editorBlock(lesson, ['exercise', 'code_challenge']);
  const check = fields.retrieval_check;
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
      rubric_id: fields.rubric_id,
    } } : {}),
    ...(check.attempt_count === 0 && (check.enabled || check.content_block_id) ? { retrieval_check: {
      enabled: check.enabled,
      ...(check.content_block_id ? { content_block_id: check.content_block_id } : {}),
      title: check.title.trim() || 'Quick check',
      prompt: check.prompt.trim(),
      options: check.options.map((option) => option.trim()),
      correct_option: check.correct_option,
      explanation: check.explanation.trim(),
      learning_objective_id: check.learning_objective_id,
    } } : {}),
    alignments: normalizedObjectiveAlignments(fields),
  };
}

function resolveRubric(lesson: LessonDetail, rubricId: number | null, rubricCatalog: Rubric[]) {
  if (!rubricId) return null;
  return rubricCatalog.find((rubric) => rubric.id === rubricId)
    || lesson.content_blocks.find((block) => block.rubric?.id === rubricId)?.rubric
    || null;
}

function checkPreviewBlock(block: LessonContentBlock, check: RetrievalCheckEditorFields): LessonContentBlock {
  return {
    ...block,
    title: check.title.trim() || 'Quick check',
    knowledge_check: {
      id: block.knowledge_check?.id || -3,
      prompt: check.prompt.trim(),
      options: check.options.map((option) => option.trim()),
      correct_option: check.correct_option,
      explanation: check.explanation.trim(),
      learning_objective_id: check.learning_objective_id,
      attempt_count: check.attempt_count,
      latest_attempt: block.knowledge_check?.latest_attempt || null,
    },
  };
}

function previewObjectives(lesson: LessonDetail, fields: LessonEditorFields, objectiveCatalog: LearningObjective[], videoId?: number, exerciseId?: number): LessonObjective[] {
  return normalizedObjectiveAlignments(fields).flatMap((alignment, index) => {
    const objective = objectiveCatalog.find((item) => item.id === alignment.learning_objective_id)
      || lesson.objectives?.find((item) => item.id === alignment.learning_objective_id);
    if (!objective) return [];
    const block = lesson.content_blocks.find((item) => item.id === alignment.content_block_id);
    const contentBlockTitle = block && [videoId, exerciseId].includes(block.id) ? fields.title.trim() : block?.title;
    return [{
      alignment_id: lesson.objectives?.find((item) => item.id === objective.id && item.content_block_id === alignment.content_block_id)?.alignment_id || -(index + 1),
      id: objective.id,
      code: objective.code,
      title: objective.title,
      description: objective.description,
      success_criteria: objective.success_criteria,
      active: objective.active,
      content_block_id: alignment.content_block_id,
      content_block_title: contentBlockTitle || null,
    }];
  });
}

export function lessonPreviewForFields(lesson: LessonDetail, fields: LessonEditorFields, objectiveCatalog: LearningObjective[] = [], rubricCatalog: Rubric[] = []): LessonDetail {
  const rubric = resolveRubric(lesson, fields.rubric_id, rubricCatalog);
  const video = editorBlock(lesson, ['video', 'recording']);
  const exercise = editorBlock(lesson, ['exercise', 'code_challenge']);
  const existingCheck = lesson.content_blocks.find((block) => block.knowledge_check);
  const blocks = lesson.content_blocks
    .filter((block) => !(block.knowledge_check && !fields.retrieval_check.enabled))
    .map((block) => {
      if (block.id === video?.id) return { ...block, title: fields.title.trim(), video_url: fields.video_url.trim() || null };
      if (block.id === exercise?.id) return { ...block, title: fields.title.trim(), body: fields.instructions.trim() || null, solution: fields.solution.trim() || null, filename: fields.filename.trim() || null, submission_type: fields.submission_type, submission_type_explicit: fields.submission_type, rubric };
      if (block.knowledge_check) return checkPreviewBlock(block, fields.retrieval_check);
      return block;
    });
  if (!video && fields.video_url.trim()) blocks.push({ id: -1, block_type: 'video', position: blocks.length + 1, title: fields.title.trim(), body: null, video_url: fields.video_url.trim(), filename: null, metadata: {} });
  if (!exercise && (fields.instructions.trim() || fields.filename.trim())) blocks.push({ id: -2, block_type: 'exercise', position: blocks.length + 1, title: fields.title.trim(), body: fields.instructions.trim() || null, solution: fields.solution.trim() || null, video_url: null, filename: fields.filename.trim() || null, submission_type: fields.submission_type, submission_type_explicit: fields.submission_type, rubric, metadata: {} });
  if (!existingCheck && fields.retrieval_check.enabled) blocks.push(checkPreviewBlock({ id: -3, block_type: 'checkpoint', position: blocks.length + 1, title: 'Quick check', body: null, video_url: null, filename: null, metadata: {} }, fields.retrieval_check));
  return { ...lesson, title: fields.title.trim() || 'Untitled lesson', required: fields.required, requires_submission: fields.submission_type !== 'manual_complete', submission_type: fields.submission_type, objectives: previewObjectives(lesson, fields, objectiveCatalog, video?.id, exercise?.id), content_blocks_count: blocks.length, content_blocks: blocks };
}

export function lessonForEditorInput(lesson: LessonDetail, input: LessonEditorInput, updatedAt = new Date().toISOString(), objectiveCatalog: LearningObjective[] = [], rubricCatalog: Rubric[] = []): LessonDetail {
  const current = fieldsForLesson(lesson);
  const fields: LessonEditorFields = {
    ...current,
    title: input.title,
    required: input.required,
    video_url: input.video ? input.video.video_url || '' : current.video_url,
    filename: input.exercise ? input.exercise.filename || '' : current.filename,
    instructions: input.exercise ? input.exercise.body || '' : current.instructions,
    solution: input.exercise ? input.exercise.solution || '' : current.solution,
    submission_type: input.exercise?.submission_type || current.submission_type,
    rubric_id: input.exercise ? input.exercise.rubric_id : current.rubric_id,
    objective_alignments: input.alignments.map((alignment) => ({ learning_objective_id: alignment.learning_objective_id, content_block_id: alignment.content_block_id || null })),
    retrieval_check: input.retrieval_check ? {
      ...current.retrieval_check,
      ...input.retrieval_check,
      content_block_id: input.retrieval_check.content_block_id,
      options: [...input.retrieval_check.options],
      attempt_count: current.retrieval_check.attempt_count,
    } : current.retrieval_check,
  };
  return { ...lessonPreviewForFields(lesson, fields, objectiveCatalog, rubricCatalog), updated_at: updatedAt };
}
