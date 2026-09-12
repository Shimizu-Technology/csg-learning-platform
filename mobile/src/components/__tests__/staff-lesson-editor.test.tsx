import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { demoLesson } from '@/lib/demo-learning';
import { ApiError } from '@/lib/api';
import { lessonForEditorInput } from '@/lib/lesson-editor';

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
  return { AlertCircle: Icon, ArrowLeft: Icon, Check: Icon, Cloud: Icon, Eye: Icon, FileCode2: Icon, Film: Icon, Pencil: Icon, RefreshCw: Icon, Save: Icon, ShieldCheck: Icon, Trash2: Icon };
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
      alignments: [],
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
