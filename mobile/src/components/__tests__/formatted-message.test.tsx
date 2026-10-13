import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { FormattedMessage } from '../formatted-message';

jest.mock('../message-code-block', () => ({ MessageCodeBlock: () => null }));

it('renders child lists within their parent item and restarts child numbering', () => {
  const screen = render(<FormattedMessage body={'1. Parent\n  1. Child\n    - Grandchild\n  2. Next child\n2. Sibling'} mentionUsers={[]} />);
  let parent = screen.getByText('Parent').parent!;
  while (parent.parent && StyleSheet.flatten(parent.props.style)?.flexShrink !== 1) parent = parent.parent;
  expect(parent.findAll((node) => node === screen.getByText('Child'))).not.toHaveLength(0);
  expect(parent.findAll((node) => node === screen.getByText('Grandchild'))).not.toHaveLength(0);
  expect(parent.findAll((node) => node === screen.getByText('Sibling'))).toHaveLength(0);
  expect(screen.getAllByText('1.')).toHaveLength(2);
  expect(screen.getAllByText('2.')).toHaveLength(2);
  expect(screen.getByText('▪')).toBeTruthy();
  expect(StyleSheet.flatten(parent.props.style)).toMatchObject({ flexShrink: 1, minWidth: 0 });
});

it('keeps inline formatting and sender colors in nested text and continuations', () => {
  const screen = render(<FormattedMessage body={'- Parent\n  - **Bold child**\n    continuation\n    > Quoted child\n- Sibling'} mentionUsers={[]} mine />);
  expect(screen.getByText('Bold child')).toBeTruthy();
  for (const label of ['continuation', 'Quoted child', 'Parent', 'Sibling']) {
    let text = screen.getByText(label);
    while (text.parent && !StyleSheet.flatten(text.props.style)?.color) text = text.parent;
    expect(StyleSheet.flatten(text.props.style).color).toBe('#FFFFFF');
  }
});
