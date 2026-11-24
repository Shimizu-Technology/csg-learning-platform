import { demoLessonFor } from '../demo-learning';
import { fieldsForLesson, lessonEditorInput } from '../lesson-editor';
import { gradingQueuePosition } from '../grading-queue';
import { githubIssueUrl } from '../external-links';

test('editing lesson fields does not rename existing video or exercise blocks', () => {
  const base = demoLessonFor(101);
  const block = base.content_blocks[0];
  const lesson = { ...base, content_blocks: [
    { ...block, id: 10, block_type: 'video', title: 'Walkthrough title' },
    { ...block, id: 11, block_type: 'exercise', title: 'Practice title' },
  ] };
  const input = lessonEditorInput(lesson, { ...fieldsForLesson(lesson), title: 'New lesson title' }, '2026-11-24');
  expect(input.title).toBe('New lesson title');
  expect(input.video).toMatchObject({ id: 10 });
  expect(input.exercise).toMatchObject({ id: 11 });
  expect(input.video).not.toHaveProperty('title');
  expect(input.exercise).not.toHaveProperty('title');
});

test('the next review stays in queue order, including a boundary item', () => {
  const submissions = [1, 2, 3].map(id => ({ id, cohort_id: 7, user_id: 42 }));
  expect(gradingQueuePosition({ submissions }, 2).next).toEqual(submissions[2]);
  expect(gradingQueuePosition({ submissions }, 3).next).toBeUndefined();
  expect(gradingQueuePosition({ submissions }, 99).next).toEqual(submissions[0]);
});

test('GitHub issue links require the exact HTTPS origin and an issue number', () => {
  expect(githubIssueUrl('https://github.com/school/repo/issues/12')).toBe('https://github.com/school/repo/issues/12');
  expect(githubIssueUrl('https://github.com.evil.test/school/repo/issues/12')).toBeNull();
  expect(githubIssueUrl('https://github.com/school/repo/pull/12')).toBeNull();
});
