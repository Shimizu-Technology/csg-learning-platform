import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { demoLessonFor } from '@/lib/demo-learning';
import { demoStaffCurriculum } from '@/lib/demo-staff';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { AlertCircle: Icon, Archive: Icon, CalendarDays: Icon, Check: Icon, Plus: Icon, RotateCcw: Icon, Save: Icon, X: Icon };
});

// Native dependencies must be mocked before loading the component.
// eslint-disable-next-line import/first
import { ExerciseEditorModal, LessonSettingsModal, ModuleEditorModal } from '../staff-curriculum-management';

describe('staff curriculum management', () => {
  const module = demoStaffCurriculum.modules[0];

  it('creates a lesson at the chosen calendar placement and opens with a useful prompt', async () => {
    const onSave = jest.fn(async () => undefined);
    const screen = render(<ExerciseEditorModal visible module={module} defaultWeek={2} onClose={jest.fn()} onSave={onSave} />);

    fireEvent.changeText(screen.getByLabelText('New lesson title'), 'CSS layout lab');
    fireEvent.changeText(screen.getByLabelText('New lesson instructions'), 'Build a responsive card layout.');
    fireEvent.press(screen.getByText('Wednesday'));
    fireEvent.press(screen.getByLabelText('Create and continue'));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'CSS layout lab', instructions: 'Build a responsive card layout.', release_day: 9, required: true, submission_type: 'manual_complete' })));
  });

  it('preserves module metadata and carries its version on edit', async () => {
    const onSave = jest.fn(async () => undefined);
    const screen = render(<ModuleEditorModal visible module={module} defaultPosition={2} onClose={jest.fn()} onSave={onSave} />);

    fireEvent.changeText(screen.getByLabelText('Module name'), 'Updated Live Class');
    fireEvent.press(screen.getByLabelText('Save module'));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Updated Live Class', position: module.position, schedule_days: module.schedule_days, base_updated_at: module.updated_at })));
  });

  it('moves a lesson without changing its authored content', async () => {
    const lesson = { ...demoLessonFor(101), curriculum_id: demoStaffCurriculum.id, module_id: module.id, release_day: 1 };
    const onMove = jest.fn(async () => undefined);
    const screen = render(<LessonSettingsModal visible lesson={lesson} module={module} onClose={jest.fn()} onMove={onMove} onToggleArchived={jest.fn()} />);

    fireEvent.press(screen.getByText('Week 2'));
    fireEvent.press(screen.getByText('Wednesday'));
    fireEvent.press(screen.getByLabelText('Move lesson'));

    await waitFor(() => expect(onMove).toHaveBeenCalledWith(9));
  });
});
