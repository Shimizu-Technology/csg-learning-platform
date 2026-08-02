import { render } from '@testing-library/react-native';

import type { LessonObjective } from '@/lib/types';
import { LessonObjectives } from '../lesson-objectives';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { CheckCircle2: Icon, Target: Icon };
});

const objective: LessonObjective = {
  alignment_id: 1,
  id: 2,
  code: 'TERM.1',
  title: 'Navigate folders',
  description: 'Use the terminal with intention.',
  success_criteria: 'I can move into a requested folder and confirm where I am.',
  active: true,
  content_block_id: 3,
  content_block_title: 'Terminal practice',
};

describe('LessonObjectives', () => {
  it('renders active success criteria and the task alignment', () => {
    const screen = render(<LessonObjectives objectives={[objective]} />);

    expect(screen.getByText('What success looks like')).toBeTruthy();
    expect(screen.getByText('TERM.1')).toBeTruthy();
    expect(screen.getByText('For Terminal practice')).toBeTruthy();
    expect(screen.getByText(objective.success_criteria)).toBeTruthy();
  });

  it('omits inactive objectives', () => {
    const screen = render(<LessonObjectives objectives={[{ ...objective, active: false }]} />);

    expect(screen.queryByText('What success looks like')).toBeNull();
  });
});
