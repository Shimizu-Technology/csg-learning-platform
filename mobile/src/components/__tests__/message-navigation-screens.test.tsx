/* eslint-disable @typescript-eslint/no-require-imports, react-hooks/globals -- Jest factories and the controlled native list expose events to these screen tests. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useWorkspace, WorkspaceProvider } from '@/providers/workspace-provider';
import { Pressable, Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import ConversationScreen from '../../app/(app)/conversation/[kind]/[id]';
import ThreadScreen from '../../app/(app)/thread/[id]';
import { messagingKeys, type ConversationSnapshot } from '@/lib/messaging-cache';
import type { Message } from '@/lib/types';

let mockParams: Record<string, string>;
let mockList: Record<string, any>;
let mockReceive: (event: unknown) => void;
const mockScrollIndex = jest.fn();
const mockScrollOffset = jest.fn();
const mockScrollEnd = jest.fn();
const mockRouter = { push: jest.fn(), back: jest.fn() };
const mockSelectWorkspace = jest.fn();
const mockApi = { channel: jest.fn(), directConversation: jest.fn(), messageThread: jest.fn(), workspace: jest.fn(), markRead: jest.fn(), workspaces: jest.fn() };
const mockUser = { id: 9, is_staff: false };
let mockUseRealWorkspace = false;
const mockSelectCohort = jest.fn();
const mockCohort = { selectedCohortId: 1, selectCohort: mockSelectCohort };
const mockWorkspaces = [{ id: 11, cohort_id: 1, workspace_type: 'cohort' }, { id: 12, cohort_id: 2, workspace_type: 'cohort' }, { id: 13, cohort_id: null, workspace_type: 'community' }];
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => mockRouter, useFocusEffect: (effect: () => void) => { require('react').useEffect(effect, [effect]); } }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: mockApi, user: mockUser }) }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: () => mockCohort }));
jest.mock('@/providers/workspace-provider', () => { const actual = jest.requireActual('@/providers/workspace-provider'); return { ...actual, useWorkspace: () => mockUseRealWorkspace ? actual.useWorkspace() : ({ workspaces: mockWorkspaces, selectWorkspace: mockSelectWorkspace }) }; });
jest.mock('@/lib/cable', () => ({ subscribeToMessages: (_api: unknown, _kind: unknown, _id: unknown, receive: typeof mockReceive) => { mockReceive = receive; return Object.assign(jest.fn(), { perform: jest.fn() }); } }));
jest.mock('@/hooks/use-voice-draft', () => ({ useVoiceDraft: () => ({ state: 'idle', cancel: async () => {} }) }));
jest.mock('@/lib/attachments', () => ({ pendingAttachment: jest.fn(), uploadAttachment: jest.fn() }));
jest.mock('expo-clipboard', () => ({}));
jest.mock('expo-document-picker', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('@/components/message-bubble', () => ({ MessageBubble: ({ message }: { message: Message }) => { const { Text } = require('react-native'); return <Text>{message.body}</Text>; } }));
jest.mock('@/components/voice-draft-controls', () => ({ VoiceDraftButton: () => null, VoiceDraftPanel: () => null }));
jest.mock('@/components/message-formatting-toolbar', () => ({ FormattingToggleButton: () => null, MessageFormattingToolbar: () => null }));
jest.mock('@/components/image-preview', () => ({ ImagePreview: () => null }));
jest.mock('@/components/reaction-details-sheet', () => ({ ReactionDetailsSheet: () => null }));
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  const React = require('react');
  return Object.create(actual, { FlatList: { value: React.forwardRef(function ControlledList(props: any, ref: any) {
    mockList = props;
    React.useImperativeHandle(ref, () => ({ scrollToIndex: mockScrollIndex, scrollToOffset: mockScrollOffset, scrollToEnd: mockScrollEnd }));
    return <actual.View>{props.data.map((item: any, index: number) => <actual.View key={props.keyExtractor(item)}>{props.renderItem({ item, index })}</actual.View>)}</actual.View>;
  }) } });
});
const message = (id: number, parent: number | null = null) => ({ id, channel_id: 4, direct_conversation_id: null, parent_message_id: parent, body: `Message ${id}`, created_at: new Date(2026, 0, 1, 0, id).toISOString(), author: { id: 2, full_name: 'Learner' }, mine: false, attachments: [], reactions: [], mention_user_ids: [] } as unknown as Message);
let client: QueryClient;
function Wrapper({ children }: PropsWithChildren) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockList = {};
  mockCohort.selectedCohortId = 1;
  mockSelectCohort.mockImplementation(async (id) => { mockCohort.selectedCohortId = id; });
  mockUseRealWorkspace = false;
  mockApi.workspaces.mockResolvedValue({ workspaces: mockWorkspaces });
  Object.defineProperty(require('react-native').AppState, 'currentState', { configurable: true, value: 'active' });
  mockParams = { kind: 'channel', id: '4' };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockApi.channel.mockResolvedValue({ channel: { id: 4, workspace_id: 12, name: 'B', unread_count: 100 }, messages: [message(200), message(201)], pinned_messages: [], meta: { oldest_message_id: 200, newest_message_id: 201, has_older: true, has_newer: false } });
  mockApi.workspace.mockResolvedValue({ workspace: { members: [] } });
  mockApi.markRead.mockResolvedValue({});
  mockApi.messageThread.mockResolvedValue({ root_message: message(1), replies: Array.from({ length: 210 }, (_, index) => message(index + 2, 1)) });
  mockSelectWorkspace.mockResolvedValue(undefined);
});
afterEach(() => client.clear());
it('resolves a reply outside the feed window, preserves its anchor and synchronizes B before Back', async () => {
  mockParams.messageId = '150';
  render(<ConversationScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/thread/[id]', params: { id: '1', kind: 'channel', conversationId: '4', workspaceId: '12', messageId: '150' } }));
  expect(mockApi.channel).toHaveBeenCalledWith(4, { message_limit: 80, around_message_id: 1 });
  await waitFor(() => expect(mockSelectWorkspace).toHaveBeenCalledWith(12));
  expect(mockApi.markRead).not.toHaveBeenCalled();
});
it('opens at latest with an unread backlog, and does not yank history on a new arrival', async () => {
  render(<ConversationScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(mockList?.data).toHaveLength(2));
  act(() => mockList.onContentSizeChange());
  await waitFor(() => expect(mockScrollOffset).toHaveBeenCalledWith({ animated: false, offset: 0 }));
  expect(mockScrollIndex).not.toHaveBeenCalled();
  act(() => mockList.onScroll({ nativeEvent: { contentOffset: { y: 600 }, contentSize: { height: 2000 }, layoutMeasurement: { height: 500 } } }));
  mockScrollOffset.mockClear();
  act(() => mockReceive({ event: 'created', channel_id: 4, message: message(202) }));
  expect(mockScrollOffset).not.toHaveBeenCalled();
  expect(mockApi.markRead).not.toHaveBeenCalled();
});
it('highlights a root anchor and waits for it to be displayed before marking it read', async () => {
  mockParams.messageId = '200';
  mockApi.messageThread.mockResolvedValue({ root_message: message(200), replies: [] });
  render(<ConversationScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(mockSelectWorkspace).toHaveBeenCalledWith(12));
  expect(mockApi.markRead).not.toHaveBeenCalled();
  act(() => mockList.onViewableItemsChanged({ viewableItems: [{ item: { message: message(200) }, isViewable: true }] }));
  expect(mockApi.markRead).toHaveBeenCalledWith('channel', 4, 200);
});
it('does not synchronize or read an inaccessible/deleted destination', async () => {
  mockParams.messageId = '150'; mockApi.messageThread.mockRejectedValue(new Error('Not found'));
  const screen = render(<ConversationScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByText('Not found')).toBeTruthy());
  expect(mockSelectWorkspace).not.toHaveBeenCalled(); expect(mockApi.markRead).not.toHaveBeenCalled();
});
it('positions and highlights a reply in a long thread, retries an unmeasured row, and reads only the displayed anchor', async () => {
  mockParams = { id: '1', kind: 'channel', conversationId: '4', workspaceId: '12', messageId: '150' };
  const screen = render(<ThreadScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('thread-message-150')).toBeTruthy());
  await waitFor(() => expect(mockSelectWorkspace).toHaveBeenCalledWith(12));
  act(() => mockList.onContentSizeChange());
  await waitFor(() => expect(mockScrollIndex).toHaveBeenCalledWith({ index: 149, animated: false, viewPosition: 0.5 }));
  expect(screen.getByTestId('thread-message-150').props.style).toBeTruthy();
  act(() => mockList.onScrollToIndexFailed({ index: 149, averageItemLength: 90 }));
  expect(mockScrollOffset).toHaveBeenCalledWith({ offset: 13410, animated: false });
  expect(mockApi.markRead).not.toHaveBeenCalled();
  act(() => mockList.onViewableItemsChanged({ viewableItems: [{ item: message(150, 1), isViewable: true }, { item: message(151, 1), isViewable: true }] }));
  expect(mockApi.markRead).toHaveBeenCalledWith('channel', 4, 150);
  mockScrollIndex.mockClear();
  act(() => mockList.onContentSizeChange());
  expect(mockScrollIndex).not.toHaveBeenCalled();
});

it('keeps the unread divider when loading history after opening at latest', async () => {
  const latest = { channel: { id: 4, workspace_id: 12, name: 'B', unread_count: 100, last_read_at: message(50).created_at }, messages: [message(200), message(201)], pinned_messages: [], meta: { oldest_message_id: 200, newest_message_id: 201, has_older: true, has_newer: false } };
  mockApi.channel.mockResolvedValueOnce(latest).mockResolvedValueOnce({ ...latest, messages: [message(49), message(50), message(51)], meta: { ...latest.meta, oldest_message_id: 49, has_older: false } });
  const screen = render(<ConversationScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(mockList?.data).toHaveLength(2));
  expect(screen.queryByText('New messages')).toBeNull();
  await act(async () => mockList.onEndReached());
  await waitFor(() => expect(screen.getByText('New messages')).toBeTruthy());
  expect(mockScrollIndex).not.toHaveBeenCalled();
});
it('does not reset a deliberate workspace change when provider data refreshes', async () => {
  const screen = render(<ConversationScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(mockSelectWorkspace).toHaveBeenCalledWith(12));
  mockSelectWorkspace.mockClear();
  screen.rerender(<ConversationScreen />);
  expect(mockSelectWorkspace).not.toHaveBeenCalled();
});

it('updates the real workspace provider to B for the inbox behind a pushed conversation', async () => {
  mockUseRealWorkspace = true;
  function InboxBehindConversation() { const workspace = useWorkspace(); return <><Text testID="inbox-workspace">{workspace.activeWorkspaceId}</Text><Pressable accessibilityLabel="Select community" onPress={() => void workspace.selectWorkspace(13)}><Text>Community</Text></Pressable></>; }
  const screen = render(<WorkspaceProvider><InboxBehindConversation /><ConversationScreen /></WorkspaceProvider>, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('inbox-workspace').props.children).toBe(12));
  expect(mockSelectCohort).toHaveBeenCalledWith(2);
  fireEvent.press(screen.getByLabelText('Select community'));
  await waitFor(() => expect(screen.getByTestId('inbox-workspace').props.children).toBe(13));
});

it('retains server unread counts until displayed messages are acknowledged', async () => {
  render(<ConversationScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(mockList?.data).toHaveLength(2));
  await act(async () => Promise.resolve());
  expect(client.getQueryData<ConversationSnapshot>(messagingKeys.conversation(9, 'channel', 4))?.summary.unread_count).toBe(100);
  expect(mockApi.markRead).not.toHaveBeenCalled();
});
