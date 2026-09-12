import { fireEvent, render } from '@testing-library/react-native';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { Braces: Icon, Gem: Icon };
});

// Native dependencies must be mocked before loading the component.
// eslint-disable-next-line import/first
import { StaffCodeRunnerSettings } from '../staff-code-runner-settings';

describe('staff code runner settings', () => {
  it('enables the runner and chooses JavaScript with accessible controls', () => {
    const onChange = jest.fn();
    const screen = render(<StaffCodeRunnerSettings value={{ enabled: false, language: 'ruby' }} onChange={onChange} />);

    fireEvent(screen.getByLabelText('Enable browser code runner'), 'valueChange', true);
    expect(onChange).toHaveBeenCalledWith({ enabled: true, language: 'ruby' });

    screen.rerender(<StaffCodeRunnerSettings value={{ enabled: true, language: 'ruby' }} onChange={onChange} />);
    fireEvent.press(screen.getByRole('radio', { name: 'JavaScript' }));
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, language: 'javascript' });
  });
});
