import type { ComponentProps } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { renderRouter, screen } from 'expo-router/testing-library';
import { NativeStackView } from 'expo-router/build/react-navigation/native-stack';
import { fireEvent, waitFor } from '@testing-library/react-native';
import AppLayout from '../../app/(app)/_layout';
import SearchScreen from '../../app/(app)/search';

jest.mock('@/components/ui/pressable-scale', () => ({ PressableScale: jest.requireActual('react-native').Pressable }));
jest.mock('standard-navigation', () => ({}));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ loaded: true, signedIn: true, demo: false }) }));
const mockApi = {
  search: jest.fn(async () => ({ results: [] })),
  searchEverything: jest.fn(async () => ({ groups: [{ type: 'dm', results: [] }], partial: true })),
};
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ user: { id: 1, is_staff: false }, api: mockApi }) }));
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
  expect(screen.getByRole('header', { name: 'Search' })).toBeTruthy();
  expect(screen.UNSAFE_getByType(SafeAreaView).props.edges).toEqual(['top', 'bottom']);
});


it('shows partial learning results with a live announcement and names direct messages', async () => {
  renderRouter({ _layout: AppLayout, search: SearchScreen }, { initialUrl: '/search' });
  fireEvent.changeText(await screen.findByLabelText('Search people and messages'), 'slow');
  fireEvent(await screen.findByLabelText('Search people and messages'), 'submitEditing');
  const notice = await screen.findByText('Some results took too long. Showing what we found.');
  expect(notice.props.accessibilityLiveRegion).toBe('polite');
  expect(notice.props['aria-live']).toBe('polite');
  expect(screen.getByRole('header', { name: 'Direct messages' })).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Search people and messages'), 'next');
  expect(screen.queryByText('Some results took too long. Showing what we found.')).toBeNull();
});
