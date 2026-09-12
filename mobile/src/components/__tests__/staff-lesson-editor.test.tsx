import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { demoLesson } from '@/lib/demo-learning';
import { ApiError } from '@/lib/api';
import { fieldsForLesson, lessonForEditorInput } from '@/lib/lesson-editor';

const mockLoadDraft = jest.fn();
const mockSaveDraft = jest.fn();
const mockClearDraft = jest.fn();

jest.mock('@/lib/curriculum-draft-storage', () => ({
  loadLessonEditorDraft: (...args: unknown[]) => mockLoadDraft(...args),
  saveLessonEditorDraft: (...args: unknown[]) => mockSaveDraft(...args),
  clearLessonEditorDraft: (...args: unknown[]) => mockClearDraft(...args),
}));
jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { AlertCircle: Icon, ArrowLeft: Icon, Check: Icon, ClipboardCheck: Icon, Cloud: Icon, Eye: Icon, FileCode2: Icon, Film: Icon, Lightbulb: Icon, Pencil: Icon, Plus: Icon, RefreshCw: Icon, RotateCcw: Icon, Save: Icon, ShieldCheck: Icon, Target: Icon, Trash2: Icon, X: Icon };
});
jest.mock('../lesson-content-block', () => ({ LessonContentBlockCard: () => null }));
jest.mock('../lesson-objectives', () => ({ LessonObjectives: () => null }));
jest.mock('../rubric-panel', () => ({ RubricPanel: () => null }));

// Native dependencies must be mocked before loading the component.
// eslint-disable-next-line import/first
import { StaffLessonEditor } from '../staff-lesson-editor';

const lesson = { ...demoLesson, updated_at: '2026-09-12T01:02:03.123456Z' };

beforeEach(() => {
  mockLoadDraft.mockResolvedValue(null);
  mockSaveDraft.mockResolvedValue(undefined);
  mockClearDraft.mockResolvedValue(undefined);
});

afterEach(() => jest.clearAllMocks());

describe('native staff lesson editor', () => {
  it('saves a guarded atomic lesson update and clears the recovered draft', async () => {
    const onSave = jest.fn(async (input) => lessonForEditorInput(lesson, input, '2026-09-12T02:00:00.000000Z'));
    const screen = render(<StaffLessonEditor lesson={lesson} userId={7} onBack={jest.fn()} onSave={onSave} onReload={async () => lesson} />);
    await waitFor(() => expect(screen.getByLabelText('Save lesson')).toBeDisabled());

    fireEvent.changeText(screen.getByLabelText('Lesson title'), 'Grid systems');
    fireEvent.changeText(screen.getByLabelText('Exercise instructions'), 'Build a resilient grid.');
    fireEvent.press(screen.getByLabelText('Save lesson'));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      base_updated_at: '2026-09-12T01:02:03.123456Z',
      title: 'Grid systems',
      exercise: expect.objectContaining({ id: 203, body: 'Build a resilient grid.', solution: expect.stringContaining('auto-fit') }),
      alignments: [{ learning_objective_id: 301, content_block_id: 203 }],
      retrieval_check: expect.objectContaining({ enabled: true, content_block_id: 202, correct_option: 1 }),
    })));
    await waitFor(() => expect(screen.getByText('Lesson saved. The student preview now uses this version.')).toBeTruthy());
    expect(mockClearDraft).toHaveBeenCalledWith(7, 101);
  });

  it('restores a device draft and previews its unsaved title', async () => {
    mockLoadDraft.mockResolvedValue({
      title: 'Recovered grid lesson', required: false, video_url: '', filename: 'styles.css', instructions: 'Recovered instructions', solution: '', submission_type: 'text_submission', base_updated_at: lesson.updated_at, saved_at: '2026-09-12T01:30:00Z',
    });
    const screen = render(<StaffLessonEditor lesson={lesson} userId={7} onBack={jest.fn()} onSave={jest.fn()} onReload={async () => lesson} />);

    expect(await screen.findByDisplayValue('Recovered grid lesson')).toBeTruthy();
    expect(screen.getByText('Draft recovered')).toBeTruthy();
    fireEvent.press(screen.getByText('Preview draft'));
    expect(screen.getAllByText('Recovered grid lesson').length).toBeGreaterThan(0);
    expect(screen.getByText('Unsaved student preview')).toBeTruthy();
  });

  it('preserves current attempt evidence instead of restoring editable stale check data', async () => {
    const attemptedLesson = { ...lesson, content_blocks: lesson.content_blocks.map((block) => block.id === 202 && block.knowledge_check ? { ...block, knowledge_check: { ...block.knowledge_check, attempt_count: 2 } } : block) };
    const staleFields = fieldsForLesson(lesson);
    mockLoadDraft.mockResolvedValue({ ...staleFields, title: 'Recovered lesson title', retrieval_check: { ...staleFields.retrieval_check, prompt: 'Unsafe stale question', attempt_count: 0 }, base_updated_at: lesson.updated_at, saved_at: '2026-09-12T01:30:00Z' });

    const screen = render(<StaffLessonEditor lesson={attemptedLesson} userId={7} onBack={jest.fn()} onSave={jest.fn()} onReload={async () => attemptedLesson} />);

    expect(await screen.findByDisplayValue('Recovered lesson title')).toBeTruthy();
    expect(screen.getByDisplayValue('Which function sets a flexible minimum and maximum track size?')).toBeTruthy();
    expect(screen.queryByDisplayValue('Unsafe stale question')).toBeNull();
    expect(screen.getByLabelText('Include quick recall check').props.disabled).toBe(true);
  });

  it('keeps the current check when a recovered draft references a replaced checkpoint', async () => {
    const staleFields = fieldsForLesson(lesson);
    mockLoadDraft.mockResolvedValue({ ...staleFields, title: 'Recovered lesson title', retrieval_check: { ...staleFields.retrieval_check, content_block_id: 999, prompt: 'Question from removed checkpoint' }, base_updated_at: lesson.updated_at, saved_at: '2026-09-12T01:30:00Z' });

    const screen = render(<StaffLessonEditor lesson={lesson} userId={7} onBack={jest.fn()} onSave={jest.fn()} onReload={async () => lesson} />);

    expect(await screen.findByDisplayValue('Recovered lesson title')).toBeTruthy();
    expect(screen.getByDisplayValue('Which function sets a flexible minimum and maximum track size?')).toBeTruthy();
    expect(screen.queryByDisplayValue('Question from removed checkpoint')).toBeNull();
  });

  it('keeps edits safe through a stale-version conflict and rebases on demand', async () => {
    const onSave = jest.fn().mockRejectedValue(new ApiError('Lesson changed', 409, 'stale_editor'));
    const latest = { ...lesson, title: 'Updated elsewhere', updated_at: '2026-09-12T03:00:00.000000Z' };
    const onReload = jest.fn().mockResolvedValue(latest);
    const screen = render(<StaffLessonEditor lesson={lesson} userId={7} onBack={jest.fn()} onSave={onSave} onReload={onReload} />);
    await waitFor(() => expect(screen.getByLabelText('Save lesson')).toBeDisabled());

    fireEvent.changeText(screen.getByLabelText('Lesson title'), 'My safe draft');
    fireEvent.press(screen.getByLabelText('Save lesson'));
    expect(await screen.findByText('Someone else updated this lesson')).toBeTruthy();
    fireEvent.press(screen.getByText('Refresh base and keep draft'));

    await waitFor(() => expect(onReload).toHaveBeenCalled());
    expect(await screen.findByText('Latest version loaded underneath your draft. Review your edits, then save again.')).toBeTruthy();
    expect(screen.getByDisplayValue('My safe draft')).toBeTruthy();
    expect(mockSaveDraft).toHaveBeenCalledWith(7, 101, expect.objectContaining({ title: 'My safe draft' }), latest.updated_at);
  });
});
