import { fireEvent, render } from '@testing-library/react-native';
import { StaffMarkdownEditor } from '../staff-markdown-editor';

jest.mock('../lesson-markdown', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { LessonMarkdown: ({ body }: { body: string }) => React.createElement(Text, { testID: 'learner-renderer' }, body) };
});

it('previews the exact source with the learner renderer without emitting an edit', () => {
  const source = '\n# Heading\n\nKeep chap\\_01 &nbsp;  \n';
  const onChange = jest.fn();
  const screen = render(<StaffMarkdownEditor value={source} onChange={onChange} />);
  expect(screen.getByLabelText('Exercise instructions')).toHaveProp('value', source);
  fireEvent.press(screen.getByLabelText('Preview Exercise instructions'));
  expect(screen.getByTestId('learner-renderer')).toHaveProp('children', source);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText('Edit Exercise instructions'));
  expect(screen.getByLabelText('Exercise instructions')).toHaveProp('value', source);
  const edited = source.replace('Heading', 'Updated heading');
  fireEvent.changeText(screen.getByLabelText('Exercise instructions'), edited);
  expect(onChange).toHaveBeenCalledWith(edited);
});
