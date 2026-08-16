import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { CommunityStandardsGate } from '../community-standards-gate';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { Check: Icon, ShieldCheck: Icon };
});

const policy = {
  version: '2026-08-17',
  accepted: false,
  accepted_at: null,
  privacy_url: 'https://learn.codeschoolofguam.com/privacy',
  terms_url: 'https://learn.codeschoolofguam.com/terms',
  deletion_url: 'https://learn.codeschoolofguam.com/account-deletion',
};

describe('CommunityStandardsGate', () => {
  it('cannot be accepted until the user explicitly agrees', async () => {
    const onAccept = jest.fn().mockResolvedValue(undefined);
    const screen = render(<CommunityStandardsGate policy={policy} onAccept={onAccept} />);
    const accept = screen.getByRole('button', { name: 'Agree and enter CSG Connect' });

    expect(accept.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(accept);
    expect(onAccept).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('checkbox'));
    fireEvent.press(screen.getByRole('button', { name: 'Agree and enter CSG Connect' }));

    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
  });

  it('opens the public terms and privacy URLs', () => {
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const screen = render(<CommunityStandardsGate policy={policy} onAccept={jest.fn()} />);

    fireEvent.press(screen.getByText('Terms & Community Guidelines'));
    fireEvent.press(screen.getByText('Privacy Policy'));

    expect(openUrl).toHaveBeenNthCalledWith(1, policy.terms_url);
    expect(openUrl).toHaveBeenNthCalledWith(2, policy.privacy_url);
  });
});
