import { fireEvent, render } from '@testing-library/react-native';
import { StaffMarkdownEditor } from '../staff-markdown-editor';

jest.mock('../lesson-markdown', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { LessonMarkdown: ({ body, starterLinks }: { body: string; starterLinks?: unknown }) => React.createElement(Text, { testID: 'learner-renderer', accessibilityHint: JSON.stringify(starterLinks) }, body) };
});

it('previews the exact source with the learner renderer without emitting an edit', () => {
  const source = '\n# Heading\n\nKeep chap\\_01 &nbsp;  \n';
  const onChange = jest.fn();
  const starterLinks = { lessonReturn: { url: 'https://learn.codeschoolofguam.com/lessons/123?cohort_id=3', label: 'Draft title' }, hint: 'practice' as const };
  const screen = render(<StaffMarkdownEditor value={source} onChange={onChange} starterLinks={starterLinks} />);
  expect(screen.getByLabelText('Exercise instructions')).toHaveProp('value', source);
  fireEvent.press(screen.getByLabelText('Preview Exercise instructions'));
  expect(screen.getByTestId('learner-renderer')).toHaveProp('children', source);
  expect(screen.getByTestId('learner-renderer')).toHaveProp('accessibilityHint', JSON.stringify(starterLinks));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText('Edit Exercise instructions'));
  expect(screen.getByLabelText('Exercise instructions')).toHaveProp('value', source);
  const edited = source.replace('Heading', 'Updated heading');
  fireEvent.changeText(screen.getByLabelText('Exercise instructions'), edited);
  expect(onChange).toHaveBeenCalledWith(edited);
});

it('labels a legacy HTML body as HTML source instead of Markdown', () => {
  const html = '<div><strong>Bold</strong> and <a href="https://example.invalid">a link</a></div>';
  const screen = render(<StaffMarkdownEditor value={html} onChange={jest.fn()} />);
  expect(screen.getByText('HTML source')).toBeTruthy();
  expect(screen.queryByText('Markdown')).toBeNull();
  fireEvent.press(screen.getByLabelText('Preview Exercise instructions'));
  expect(screen.getByText('Edit source')).toBeTruthy();
});
