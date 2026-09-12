import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { demoLearningObjectives, demoLesson, demoRubrics } from '@/lib/demo-learning';
import { fieldsForLesson } from '@/lib/lesson-editor';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { AlertCircle: Icon, Check: Icon, ClipboardCheck: Icon, Lightbulb: Icon, Plus: Icon, RotateCcw: Icon, Target: Icon, Trash2: Icon, X: Icon };
});

// Native dependencies must be mocked before loading the component.
// eslint-disable-next-line import/first
import { StaffLearningDesignEditor } from '../staff-learning-design-editor';

describe('native lesson learning design editor', () => {
  const fields = fieldsForLesson(demoLesson);

  it('changes an objective target and edits the protected recall-check draft', () => {
    const onChange = jest.fn();
    const screen = render(<StaffLearningDesignEditor lesson={demoLesson} fields={fields} objectives={demoLearningObjectives} rubrics={demoRubrics} catalogLoading={false} catalogError={false} canCreateResources={false} onRetryCatalogs={jest.fn()} onChange={onChange} onCreateObjective={jest.fn()} onCreateRubric={jest.fn()} />);

    fireEvent.press(screen.getByText('Whole lesson'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ objective_alignments: [{ learning_objective_id: 301, content_block_id: null }] }));

    fireEvent.changeText(screen.getByLabelText('Quick check question'), 'Which CSS function defines a track range?');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ retrieval_check: expect.objectContaining({ prompt: 'Which CSS function defines a track range?', correct_option: 1 }) }));
  });

  it('lets admins create and attach a reusable objective', async () => {
    const objective = { ...demoLearningObjectives[1], id: 999 };
    const onCreateObjective = jest.fn().mockResolvedValue(objective);
    const onChange = jest.fn();
    const screen = render(<StaffLearningDesignEditor lesson={demoLesson} fields={fields} objectives={demoLearningObjectives} rubrics={demoRubrics} catalogLoading={false} catalogError={false} canCreateResources onRetryCatalogs={jest.fn()} onChange={onChange} onCreateObjective={onCreateObjective} onCreateRubric={jest.fn()} />);

    fireEvent.press(screen.getByLabelText('Create learning objective'));
    fireEvent.changeText(screen.getByLabelText('Objective code'), 'CSS.5');
    fireEvent.changeText(screen.getByLabelText('Objective title'), 'Explain layout tradeoffs');
    fireEvent.changeText(screen.getByLabelText('Objective success criteria'), 'I can explain why a layout adapts.');
    fireEvent.press(screen.getByLabelText('Create objective'));

    await waitFor(() => expect(onCreateObjective).toHaveBeenCalledWith({ code: 'CSS.5', title: 'Explain layout tradeoffs', description: undefined, success_criteria: 'I can explain why a layout adapts.' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ objective_alignments: [...fields.objective_alignments, { learning_objective_id: 999, content_block_id: null }] }));
  });

  it('lets admins create and select a reusable rubric', async () => {
    const rubric = { ...demoRubrics[0], id: 999, title: 'Explanation quality' };
    const onCreateRubric = jest.fn().mockResolvedValue(rubric);
    const onChange = jest.fn();
    const screen = render(<StaffLearningDesignEditor lesson={demoLesson} fields={fields} objectives={demoLearningObjectives} rubrics={demoRubrics} catalogLoading={false} catalogError={false} canCreateResources onRetryCatalogs={jest.fn()} onChange={onChange} onCreateObjective={jest.fn()} onCreateRubric={onCreateRubric} />);

    fireEvent.press(screen.getByLabelText('Create rubric'));
    fireEvent.changeText(screen.getByLabelText('Rubric title'), 'Explanation quality');
    fireEvent.changeText(screen.getByLabelText('Rubric criterion 1 title'), 'Reasoning');
    fireEvent.changeText(screen.getByLabelText('Rubric criterion 1 description'), 'Connects the technique to the layout need.');
    fireEvent.press(screen.getByLabelText('Remove rubric criterion 2'));
    fireEvent.press(screen.getAllByLabelText('Create rubric')[1]);

    await waitFor(() => expect(onCreateRubric).toHaveBeenCalledWith({ title: 'Explanation quality', description: undefined, criteria: [{ title: 'Reasoning', description: 'Connects the technique to the layout need.' }] }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rubric_id: 999 }));
  });

  it('locks a retrieval check after student attempts exist', () => {
    const attemptedFields = { ...fields, retrieval_check: { ...fields.retrieval_check, attempt_count: 2 } };
    const screen = render(<StaffLearningDesignEditor lesson={demoLesson} fields={attemptedFields} objectives={demoLearningObjectives} rubrics={demoRubrics} catalogLoading={false} catalogError={false} canCreateResources={false} onRetryCatalogs={jest.fn()} onChange={jest.fn()} onCreateObjective={jest.fn()} onCreateRubric={jest.fn()} />);

    expect(screen.getByText('2 student attempts are recorded. Create a new check if the standard changes.')).toBeTruthy();
    expect(screen.getByLabelText('Include quick recall check').props.disabled).toBe(true);
    expect(screen.getByLabelText('Quick check question').props.editable).toBe(false);
  });

  it('keeps curriculum resource creation admin-only', () => {
    const screen = render(<StaffLearningDesignEditor lesson={demoLesson} fields={fields} objectives={demoLearningObjectives} rubrics={demoRubrics} catalogLoading={false} catalogError={false} canCreateResources={false} onRetryCatalogs={jest.fn()} onChange={jest.fn()} onCreateObjective={jest.fn()} onCreateRubric={jest.fn()} />);
    expect(screen.queryByLabelText('Create learning objective')).toBeNull();
    expect(screen.queryByLabelText('Create rubric')).toBeNull();
  });

  it('gives same-type block targets distinct labels', () => {
    const secondExercise = { ...demoLesson.content_blocks[2], id: 204, position: 4, title: 'Explain the alternate grid' };
    const screen = render(<StaffLearningDesignEditor lesson={{ ...demoLesson, content_blocks: [...demoLesson.content_blocks, secondExercise] }} fields={fields} objectives={demoLearningObjectives} rubrics={demoRubrics} catalogLoading={false} catalogError={false} canCreateResources={false} onRetryCatalogs={jest.fn()} onChange={jest.fn()} onCreateObjective={jest.fn()} onCreateRubric={jest.fn()} />);

    expect(screen.getByLabelText('Exercise 3 · Rebuild the card grid')).toBeTruthy();
    expect(screen.getByLabelText('Exercise 4 · Explain the alternate grid')).toBeTruthy();
  });
});
