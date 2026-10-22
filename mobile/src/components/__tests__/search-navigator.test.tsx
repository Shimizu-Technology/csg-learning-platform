import type { ComponentProps } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { renderRouter, screen } from 'expo-router/testing-library';
import { NativeStackView } from 'expo-router/build/react-navigation/native-stack';
import { waitFor } from '@testing-library/react-native';
import AppLayout from '../../app/(app)/_layout';
import SearchScreen from '../../app/(app)/search';

jest.mock('@/components/ui/pressable-scale', () => ({ PressableScale: jest.requireActual('react-native').Pressable }));
jest.mock('standard-navigation', () => ({}));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ loaded: true, signedIn: true, demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ user: { id: 1, is_staff: false }, api: {} }) }));
jest.mock('@/providers/workspace-provider', () => ({ useWorkspace: () => ({ workspaces: [] }) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));

it('presents search through the app navigator without a native header above its safe-area form', async () => {
  renderRouter({ _layout: AppLayout, search: SearchScreen }, { initialUrl: '/search' });
  await screen.findByLabelText('Search people and messages');
  await waitFor(() => {
    const stacks = screen.UNSAFE_getAllByType(NativeStackView);
    const descriptor = stacks.flatMap((stack) => Object.values(stack.props.descriptors as ComponentProps<typeof NativeStackView>['descriptors'])).find((entry) => entry.route.name === 'search');
    expect(descriptor?.options).toEqual(expect.objectContaining({ headerShown: false, presentation: 'formSheet', sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true }));
  });
  expect(screen.getByRole('header', { name: 'Search messages' })).toBeTruthy();
  expect(screen.UNSAFE_getByType(SafeAreaView).props.edges).toEqual(['top', 'bottom']);
});
