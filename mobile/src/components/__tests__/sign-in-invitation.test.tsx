import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) }));
jest.mock('@clerk/expo', () => ({ useSignIn: () => ({ signIn: {}, errors: { fields: {}, global: null }, fetchStatus: 'idle' }), useSSO: () => ({ startSSOFlow: jest.fn() }) }));
jest.mock('expo-auth-session', () => ({ makeRedirectUri: () => 'csgconnect://oauth-callback' }));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

// Native dependencies must be mocked before loading the screen.
// eslint-disable-next-line import/first
import SignIn from '../../app/(auth)/sign-in';

describe('sign-in invitation help', () => {
  it('tells first-time learners to use their invitation email', () => {
    const screen = render(<SignIn />);

    expect(screen.getByText('First time here?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask for a new invitation' })).toBeTruthy();
  });

  it('shows the help address in the panel when no email app opens', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('No mail app'));
    const screen = render(<SignIn />);

    fireEvent.press(screen.getByRole('button', { name: 'Ask for a new invitation' }));

    await waitFor(() => expect(screen.getByText('No email app opened. Email codeschoolofguam@gmail.com and ask for a new invitation.')).toBeTruthy());
  });
});
