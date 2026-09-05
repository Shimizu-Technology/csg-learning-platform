import { render } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';

import { MESSAGE_BODY_LIMIT } from '@/lib/message-compose';
import { ComposerLimitNotice } from '../composer-limit-notice';

describe('ComposerLimitNotice', () => {
  afterEach(() => jest.restoreAllMocks());

  it('appears only for an over-limit draft with the shared character count', () => {
    jest.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function formatNumber(this: number) { return String(Number(this)); });
    const valid = render(<ComposerLimitNotice value={'a'.repeat(MESSAGE_BODY_LIMIT)} />);
    expect(valid.queryByRole('alert')).toBeNull();

    const overflow = render(<ComposerLimitNotice value={'🚀'.repeat(MESSAGE_BODY_LIMIT + 1)} />);
    expect(overflow.getByRole('alert')).toBeTruthy();
    expect(overflow.getByText(/5001 now/)).toBeTruthy();
  });

  it('announces only the transition into an over-limit draft on iOS', () => {
    if (Platform.OS !== 'ios') return;
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    announce.mockClear();
    const notice = render(<ComposerLimitNotice value="Short draft" />);

    notice.rerender(<ComposerLimitNotice value={'a'.repeat(MESSAGE_BODY_LIMIT + 1)} />);
    notice.rerender(<ComposerLimitNotice value={'a'.repeat(MESSAGE_BODY_LIMIT + 2)} />);

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('Shorten this draft'));
  });
});
