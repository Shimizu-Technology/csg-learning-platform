import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, Platform } from 'react-native';

import { TypingIndicator } from '../typing-indicator';

describe('TypingIndicator', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is hidden when nobody is typing', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const indicator = render(<TypingIndicator users={[]} />);
    await act(async () => { await Promise.resolve(); });

    expect(indicator.queryByText(/typing/)).toBeNull();
  });

  it('announces a changed typing label on iOS', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const indicator = render(<TypingIndicator users={[]} />);
    await act(async () => { await Promise.resolve(); });

    indicator.rerender(<TypingIndicator users={[{ id: 9, full_name: 'Ada', avatar_url: null }]} />);
    indicator.rerender(<TypingIndicator users={[{ id: 9, full_name: 'Ada', avatar_url: null }]} />);

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Ada is typing…');
  });

  it('keeps dots static until reduced-motion lookup resolves false', async () => {
    let resolveReduceMotion!: (enabled: boolean) => void;
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(
      () => new Promise<boolean>((resolve) => { resolveReduceMotion = resolve; }),
    );
    const loopSpy = jest.spyOn(Animated, 'loop');

    render(<TypingIndicator users={[{ id: 9, full_name: 'Ada', avatar_url: null }]} />);
    expect(loopSpy).not.toHaveBeenCalled();

    await act(async () => {
      resolveReduceMotion(false);
      await Promise.resolve();
    });
    expect(loopSpy).toHaveBeenCalledTimes(3);
  });
});
