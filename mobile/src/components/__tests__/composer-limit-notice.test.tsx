import { render } from '@testing-library/react-native';

import { MESSAGE_BODY_LIMIT } from '@/lib/message-compose';
import { ComposerLimitNotice } from '../composer-limit-notice';

describe('ComposerLimitNotice', () => {
  it('appears only for an over-limit draft with the shared character count', () => {
    const valid = render(<ComposerLimitNotice value={'a'.repeat(MESSAGE_BODY_LIMIT)} />);
    expect(valid.queryByRole('alert')).toBeNull();

    const overflow = render(<ComposerLimitNotice value={'🚀'.repeat(MESSAGE_BODY_LIMIT + 1)} />);
    expect(overflow.getByText(/5,001 now/)).toBeTruthy();
  });
});
