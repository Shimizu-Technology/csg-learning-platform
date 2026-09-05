import { render } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';

import { TypingIndicator } from '../typing-indicator';

describe('TypingIndicator', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is hidden when nobody is typing', () => {
    const indicator = render(<TypingIndicator users={[]} />);

    expect(indicator.queryByText(/typing/)).toBeNull();
  });

  it('announces a changed typing label on iOS', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const indicator = render(<TypingIndicator users={[]} />);

    indicator.rerender(<TypingIndicator users={[{ id: 9, full_name: 'Ada', avatar_url: null }]} />);
    indicator.rerender(<TypingIndicator users={[{ id: 9, full_name: 'Ada', avatar_url: null }]} />);

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Ada is typing…');
  });
});
