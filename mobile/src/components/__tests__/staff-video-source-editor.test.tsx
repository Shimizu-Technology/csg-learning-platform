import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockPick = jest.fn();
const mockPickFromPhotos = jest.fn();

jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockPick(...args) }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (...args: unknown[]) => mockPickFromPhotos(...args) }));
jest.mock('expo-file-system', () => ({ File: class MockFile { size = 0; type = ''; uri: string; constructor(uri: string) { this.uri = uri; } } }));
jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { CheckCircle2: Icon, Film: Icon, Link2: Icon, ShieldCheck: Icon, UploadCloud: Icon, X: Icon };
});

// Native dependencies must be mocked before loading the component.
// eslint-disable-next-line import/first
import { StaffVideoSourceEditor } from '../staff-video-source-editor';

const emptyValue = { video_url: '', s3_video_key: null, s3_video_content_type: null, s3_video_size: null };

beforeEach(() => jest.clearAllMocks());

describe('staff lesson video source editor', () => {
  it('uploads a selected video and stages its exact metadata for lesson save', async () => {
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///grid.mov', name: 'grid.mov', size: 4096, mimeType: 'video/quicktime' }] });
    const onChange = jest.fn();
    const onUpload = jest.fn(async (_asset, onProgress) => {
      onProgress(70, 'Uploading video…');
      return { s3_video_key: 'content_videos/grid.mov', s3_video_content_type: 'video/quicktime', s3_video_size: 4096 };
    });
    const screen = render(<StaffVideoSourceEditor value={emptyValue} persistedS3Key={null} onChange={onChange} onUpload={onUpload} onAbandon={jest.fn()} />);

    fireEvent.press(screen.getByText('Upload file'));
    fireEvent.press(screen.getByLabelText('Choose lesson video from files'));

    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(expect.objectContaining({ name: 'grid.mov', mimeType: 'video/quicktime', size: 4096 }), expect.any(Function)));
    expect(onChange).toHaveBeenLastCalledWith({ s3_video_key: 'content_videos/grid.mov', s3_video_content_type: 'video/quicktime', s3_video_size: 4096, video_url: '' });
  });

  it('offers the photo library as a direct video source', async () => {
    mockPickFromPhotos.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///library.mp4', fileName: 'library.mp4', fileSize: 8192, mimeType: 'video/mp4' }] });
    const onUpload = jest.fn(async (asset) => ({ s3_video_key: `content_videos/${asset.name}`, s3_video_content_type: asset.mimeType, s3_video_size: asset.size }));
    const onChange = jest.fn();
    const screen = render(<StaffVideoSourceEditor value={emptyValue} persistedS3Key={null} onChange={onChange} onUpload={onUpload} onAbandon={jest.fn()} />);

    fireEvent.press(screen.getByText('Upload file'));
    fireEvent.press(screen.getByLabelText('Choose lesson video from photos'));

    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(expect.objectContaining({ name: 'library.mp4', mimeType: 'video/mp4', size: 8192 }), expect.any(Function)));
    expect(onChange).toHaveBeenLastCalledWith({ s3_video_key: 'content_videos/library.mp4', s3_video_content_type: 'video/mp4', s3_video_size: 8192, video_url: '' });
  });

  it('rejects an unknown file when neither its extension nor MIME type identifies a supported video', async () => {
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///mystery.bin', name: 'mystery.bin', size: 4096, mimeType: null }] });
    const onUpload = jest.fn();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const screen = render(<StaffVideoSourceEditor value={emptyValue} persistedS3Key={null} onChange={jest.fn()} onUpload={onUpload} onAbandon={jest.fn()} />);

    fireEvent.press(screen.getByText('Upload file'));
    fireEvent.press(screen.getByLabelText('Choose lesson video from files'));

    await waitFor(() => expect(alert).toHaveBeenCalledWith('Choose a supported video', 'Use an MP4, MOV, M4V, or WebM video.'));
    expect(onUpload).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('switches a saved hosted video to a link without deleting the still-referenced object', async () => {
    const onChange = jest.fn();
    const onAbandon = jest.fn();
    const value = { video_url: '', s3_video_key: 'content_videos/saved.mp4', s3_video_content_type: 'video/mp4', s3_video_size: 2048 };
    const screen = render(<StaffVideoSourceEditor value={value} persistedS3Key={value.s3_video_key} onChange={onChange} onUpload={jest.fn()} onAbandon={onAbandon} />);

    fireEvent.press(screen.getByText('Use link'));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ s3_video_key: null, s3_video_content_type: null, s3_video_size: null }));
    expect(onAbandon).not.toHaveBeenCalled();
  });

  it('shows the original name instead of managed storage prefixes', () => {
    const value = { video_url: '', s3_video_key: 'content_videos/block_8/20260913024400_deadbeef_grid-walkthrough.mp4', s3_video_content_type: 'video/mp4', s3_video_size: 2048 };
    const screen = render(<StaffVideoSourceEditor value={value} persistedS3Key={value.s3_video_key} onChange={jest.fn()} onUpload={jest.fn()} onAbandon={jest.fn()} />);

    expect(screen.getByText('grid-walkthrough.mp4')).toBeTruthy();
    expect(screen.getByText(/2 KB/)).toBeTruthy();
  });

  it('returns to the saved source mode when parent data is restored', async () => {
    const screen = render(<StaffVideoSourceEditor value={emptyValue} persistedS3Key={null} onChange={jest.fn()} onUpload={jest.fn()} onAbandon={jest.fn()} />);
    const savedValue = { video_url: '', s3_video_key: 'content_videos/saved.mp4', s3_video_content_type: 'video/mp4', s3_video_size: 2048 };

    screen.rerender(<StaffVideoSourceEditor value={savedValue} persistedS3Key={savedValue.s3_video_key} onChange={jest.fn()} onUpload={jest.fn()} onAbandon={jest.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Upload file' }).props.accessibilityState).toMatchObject({ selected: true }));
    expect(screen.getByText('Self-hosted video')).toBeTruthy();
  });

  it('abandons a newly staged orphan before switching sources', async () => {
    const onChange = jest.fn();
    const onAbandon = jest.fn().mockResolvedValue(undefined);
    const value = { video_url: '', s3_video_key: 'content_videos/staged.mp4', s3_video_content_type: 'video/mp4', s3_video_size: 2048 };
    const screen = render(<StaffVideoSourceEditor value={value} persistedS3Key={'content_videos/saved.mp4'} onChange={onChange} onUpload={jest.fn()} onAbandon={onAbandon} />);

    fireEvent.press(screen.getByText('Use link'));

    await waitFor(() => expect(onAbandon).toHaveBeenCalledWith('content_videos/staged.mp4'));
    expect(onChange).toHaveBeenCalledWith({ s3_video_key: null, s3_video_content_type: null, s3_video_size: null });
  });

  it('preserves the previous staged video when replacement cleanup fails', async () => {
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///replacement.mp4', name: 'replacement.mp4', size: 8192, mimeType: 'video/mp4' }] });
    const oldKey = 'content_videos/staged-old.mp4';
    const newKey = 'content_videos/staged-new.mp4';
    const value = { video_url: '', s3_video_key: oldKey, s3_video_content_type: 'video/mp4', s3_video_size: 4096 };
    const onChange = jest.fn();
    const onAbandon = jest.fn().mockRejectedValue(new Error('Storage cleanup failed'));
    const onCleanupDeferred = jest.fn().mockResolvedValue(undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const screen = render(<StaffVideoSourceEditor value={value} persistedS3Key={null} onChange={onChange} onUpload={jest.fn().mockResolvedValue({ s3_video_key: newKey, s3_video_content_type: 'video/mp4', s3_video_size: 8192 })} onAbandon={onAbandon} onCleanupDeferred={onCleanupDeferred} />);

    fireEvent.press(screen.getByLabelText('Replace hosted video from files'));

    await waitFor(() => expect(onAbandon).toHaveBeenCalledWith(oldKey));
    expect(onAbandon).toHaveBeenCalledWith(newKey);
    expect(onCleanupDeferred).toHaveBeenCalledWith(newKey);
    expect(onChange).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Video change did not finish', 'Storage cleanup failed');
    alert.mockRestore();
  });
});
