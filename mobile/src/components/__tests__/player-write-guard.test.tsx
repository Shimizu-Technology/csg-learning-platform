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
  const progress = () => {
    if (kind === 'native') {
      mockListeners.sourceLoad({ duration: 100 } as never);
      mockListeners.playingChange({ isPlaying: false } as never);
    } else {
      screen.getByLabelText('Test YouTube player').props.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'progress', position: 12, duration: 100, playing: false }) } });
    }
  };
  act(progress);
  expect(save).toHaveBeenCalledTimes(1);
  act(progress);
  screen.rerender(element(false, nextSave));
  expect(save).toHaveBeenCalledTimes(1);
  expect(nextSave).not.toHaveBeenCalled();
  await act(async () => { finishSave(); });
  act(progress);
  screen.unmount();
  expect(save).toHaveBeenCalledTimes(1);
  expect(nextSave).not.toHaveBeenCalled();
});
