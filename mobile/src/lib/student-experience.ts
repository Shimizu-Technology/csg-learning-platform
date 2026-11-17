import type { components } from './api.generated';

// The redesigned student experience (W8), one feature switch shared with web
// (`web/src/lib/studentExperience.tsx`): school default on, Off for cohorts
// that were already running when it shipped. Off keeps every native screen as
// it was. Native visual parity follows; for now the native screens read the
// same server data (the lesson kind from LessonKind) where the switch is on.
export const STUDENT_EXPERIENCE_SWITCH = 'student_experience_v2';

export type LessonKind = components['schemas']['LessonKind'];

/** Whether a resolved feature map has the redesign on. Missing means the school default, which is on. */
export function studentExperienceV2(features?: Record<string, boolean> | null) {
  return features?.[STUDENT_EXPERIENCE_SWITCH] !== false;
}

export const LESSON_KIND_LABELS: Record<LessonKind, string> = {
  exercise: 'Exercise',
  project: 'Project',
  video: 'Video',
  recording: 'Recording',
  checkpoint: 'Check',
  reading: 'Reading',
};

/** A lesson's type line: the real kind from its blocks with the switch on, the stored type as before when off. */
export function lessonTypeLabel(lesson: { lesson_type: string; kind?: LessonKind | null }, v2: boolean) {
  return v2 && lesson.kind ? LESSON_KIND_LABELS[lesson.kind] : lesson.lesson_type;
}
