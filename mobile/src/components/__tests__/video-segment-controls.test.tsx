import { render } from '@testing-library/react-native';
import { VideoSegmentControls } from '../video-segment-controls';
import { themes } from '@/constants/csg-theme';
import { contrastRatio } from '@/test-utils/contrast';

jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
const segment = { label: 'Introduction', start_seconds: 0, end_seconds: 12, required: true };
it('overrides every active row edge, including the base bottom hairline', () => {
  const ui = render(<VideoSegmentControls segments={[segment]} activeSegment={segment} onSelect={jest.fn()} />);
  expect(ui.getByRole('button')).toHaveStyle({ borderWidth: 2, borderColor: themes.light.colors.selection.indicator, borderBottomWidth: 2, borderBottomColor: themes.light.colors.selection.indicator });
  expect(ui.getByRole('button').props.accessibilityState.selected).toBe(true);
});
it('pairs completed section text with the success surface', () => {
  const ui = render(<VideoSegmentControls segments={[segment]} completedSegment={segment} onSelect={jest.fn()} />);
  const c = themes.light.colors;
  expect(ui.getByText('Section finished')).toHaveStyle({ color: c.status.success.fg, backgroundColor: c.status.success.bg });
  expect(contrastRatio(c.status.success.fg, c.status.success.bg)).toBeGreaterThanOrEqual(4.5);
});
