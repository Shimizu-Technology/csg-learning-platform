import { act, cleanup, render } from '@testing-library/react-native';
import { NativeVideoPlayer } from '../native-video-player';
import { InAppMediaPlayer } from '../in-app-media-player';

const mockListeners: Record<string, (event: never) => void> = {};
const mockPlayer = { replaceAsync: jest.fn().mockResolvedValue(undefined), pause: jest.fn(), play: jest.fn(), currentTime: 0 };
jest.mock('expo', () => ({ useEventListener: (_player: unknown, name: string, listener: (event: never) => void) => { mockListeners[name] = listener; } }));
jest.mock('expo-video', () => ({ useVideoPlayer: () => mockPlayer, VideoView: jest.requireActual('react-native').View }));
jest.mock('expo-screen-orientation', () => ({ lockAsync: jest.fn().mockResolvedValue(undefined), OrientationLock: { PORTRAIT_UP: 1 } }));
jest.mock('react-native-webview', () => ({ WebView: jest.requireActual('react-native').View }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('@/lib/external-links', () => ({ openExternalPage: jest.fn() }));
const fetchStream = () => Promise.resolve({ stream_url: 'https://example.com/video.mp4', expires_at: new Date(Date.now() + 3600000).toISOString() });

afterEach(cleanup);
it.each(['native', 'embedded'])('%s player stops cleanup, queued, and later event saves when tracking is disabled', async (kind) => {
  let finishSave!: () => void;
  const save = jest.fn(() => new Promise<void>(resolve => { finishSave = resolve; }));
  const nextSave = jest.fn().mockResolvedValue(undefined);
  const element = (trackProgress: boolean, saveProgress = save) => kind === 'native'
    ? <NativeVideoPlayer title="Test" fetchStream={fetchStream} saveProgress={saveProgress} trackProgress={trackProgress} />
    : <InAppMediaPlayer title="Test" url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" saveProgress={saveProgress} trackProgress={trackProgress} />;
  const screen = render(element(true));
  await act(async () => {});
  const progress = (playing = false) => {
    if (kind === 'native') {
      mockListeners.sourceLoad({ duration: 100 } as never);
      mockListeners.playingChange({ isPlaying: false } as never);
    } else {
      screen.getByLabelText('Test YouTube player').props.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'progress', position: 12, duration: 100, playing }) } });
    }
  };
  act(() => progress(true));
  expect(save).toHaveBeenCalledTimes(1);
  act(() => progress());
  screen.rerender(element(false, nextSave));
  expect(save).toHaveBeenCalledTimes(1);
  expect(nextSave).not.toHaveBeenCalled();
  await act(async () => { finishSave(); });
  act(() => {
    progress(true);
    progress();
  });
  screen.unmount();
  expect(save).toHaveBeenCalledTimes(1);
  expect(nextSave).not.toHaveBeenCalled();
});

it('lets lesson section saves through when rounded native progress has not changed', async () => {
  const saveProgress = jest.fn().mockResolvedValue(undefined);
  const screen = render(<NativeVideoPlayer title="Test" fetchStream={fetchStream} saveProgress={saveProgress} onPlaybackSample={jest.fn()} trackProgress />);
  await act(async () => {});

  await act(async () => {
    mockListeners.sourceLoad({ duration: 100 } as never);
    mockListeners.playingChange({ isPlaying: true } as never);
  });
  await act(async () => {
    mockListeners.timeUpdate({ currentTime: 0.2 } as never);
    mockListeners.playingChange({ isPlaying: false } as never);
  });

  expect(saveProgress).toHaveBeenCalledTimes(2);
  expect(saveProgress.mock.calls[1]).toEqual(saveProgress.mock.calls[0]);
  screen.unmount();
});

it('keeps a direct native stream loaded through progress refreshes', async () => {
  mockPlayer.replaceAsync.mockClear();
  const saveProgress = jest.fn().mockResolvedValue(undefined);
  const element = (url: string, position: number) => <InAppMediaPlayer
    title="Test" url={url} initialPosition={position} initialTotalWatched={position} saveProgress={saveProgress} trackProgress
  />;
  const url = 'https://example.com/video.mp4';
  const screen = render(element(url, 0));
  await act(async () => {});
  expect(mockPlayer.replaceAsync).toHaveBeenCalledTimes(1);
  screen.rerender(element(url, 8));
  await act(async () => {});
  expect(mockPlayer.replaceAsync).toHaveBeenCalledTimes(1);

  const nextUrl = 'https://example.com/alternate.mp4';
  screen.rerender(element(nextUrl, 8));
  await act(async () => {});
  expect(mockPlayer.replaceAsync).toHaveBeenCalledTimes(2);
  expect(mockPlayer.replaceAsync).toHaveBeenLastCalledWith(expect.objectContaining({ uri: nextUrl }));
});
