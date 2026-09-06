import { fireEvent, render } from '@testing-library/react-native';

import { GradingReviewActions } from '../grading-review-actions';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { Check: Icon, CheckCircle2: Icon, RotateCcw: Icon };
});

describe('GradingReviewActions', () => {
  it('selects a grade without saving the review', () => {
    const onSelect = jest.fn();
    const onSave = jest.fn();
    const screen = render(<GradingReviewActions selected={null} changed={false} saving={false} onSelect={onSelect} onSave={onSave} />);

    fireEvent.press(screen.getByLabelText('Select grade A'));

    expect(onSelect).toHaveBeenCalledWith('A');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves only through the explicit action after a review changes', () => {
    const onSave = jest.fn();
    const screen = render(<GradingReviewActions selected="A" changed saving={false} onSelect={jest.fn()} onSave={onSave} />);

    fireEvent.press(screen.getByLabelText('Save grade A'));

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('keeps the save action disabled until the review changes', () => {
    const onSave = jest.fn();
    const screen = render(<GradingReviewActions selected="B" changed={false} saving={false} onSelect={jest.fn()} onSave={onSave} />);

    fireEvent.press(screen.getByLabelText('Save grade B'));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Save grade B').props.accessibilityState).toEqual({ disabled: true });
  });
});
