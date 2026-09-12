import { fireEvent, render } from '@testing-library/react-native';

import { demoStaffCurriculum } from '@/lib/demo-staff';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    Archive: Icon,
    ArrowRight: Icon,
    BookOpen: Icon,
    Check: Icon,
    ChevronDown: Icon,
    ChevronUp: Icon,
    CircleDot: Icon,
    Plus: Icon,
    Lock: Icon,
    Search: Icon,
    Settings2: Icon,
  };
});

// Native dependencies must be mocked before loading the component.
// eslint-disable-next-line import/first
import { StaffCurriculumDetailView, StaffCurriculumLibrary } from '../staff-curriculum';

describe('staff curriculum browsing', () => {
  it('opens a curriculum and searches directly across its lessons', () => {
    const openCurriculum = jest.fn();
    const openLesson = jest.fn();
    const onFilterChange = jest.fn();
    const screen = render(<StaffCurriculumLibrary curricula={[demoStaffCurriculum]} filter="" onFilterChange={onFilterChange} onOpenCurriculum={openCurriculum} onOpenLesson={openLesson} />);

    fireEvent.press(screen.getByLabelText('Open CSG Full-Stack Bootcamp 2026'));
    expect(openCurriculum).toHaveBeenCalledWith(3);

    screen.rerender(<StaffCurriculumLibrary curricula={[demoStaffCurriculum]} filter="grid" onFilterChange={onFilterChange} onOpenCurriculum={openCurriculum} onOpenLesson={openLesson} />);
    expect(screen.getByText('Responsive layouts with Grid')).toBeTruthy();
    expect(screen.queryByText('Accessible forms')).toBeNull();
    fireEvent.press(screen.getByLabelText('Preview Responsive layouts with Grid'));
    expect(openLesson).toHaveBeenCalledWith(101);
  });

  it('moves through module weeks and exposes optional lesson status', () => {
    const screen = render(<StaffCurriculumDetailView curriculum={demoStaffCurriculum} filter="" onFilterChange={jest.fn()} onOpenLesson={jest.fn()} />);

    expect(screen.getByText('HTML and semantic structure')).toBeTruthy();
    fireEvent.press(screen.getByText('Week 2'));
    expect(screen.getByText('Container query stretch')).toBeTruthy();
    expect(screen.getByText('OPTIONAL')).toBeTruthy();
  });

  it('exposes lesson creation to staff and module settings only to admins', () => {
    const addLesson = jest.fn();
    const editModule = jest.fn();
    const screen = render(<StaffCurriculumDetailView curriculum={demoStaffCurriculum} filter="" onFilterChange={jest.fn()} onOpenLesson={jest.fn()} onAddLesson={addLesson} onEditModule={editModule} />);

    fireEvent.press(screen.getByLabelText('Add lesson to Live Class'));
    expect(addLesson).toHaveBeenCalledWith(demoStaffCurriculum.modules[0], 1);
    expect(screen.queryByLabelText('Edit Live Class settings')).toBeNull();

    screen.rerender(<StaffCurriculumDetailView curriculum={demoStaffCurriculum} filter="" onFilterChange={jest.fn()} onOpenLesson={jest.fn()} canManageModules onAddLesson={addLesson} onEditModule={editModule} onAddModule={jest.fn()} />);
    fireEvent.press(screen.getByLabelText('Edit Live Class settings'));
    expect(editModule).toHaveBeenCalledWith(demoStaffCurriculum.modules[0]);
    expect(screen.getByLabelText('Create module')).toBeTruthy();
  });
});
