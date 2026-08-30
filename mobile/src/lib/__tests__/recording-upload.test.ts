const mockFetch = jest.fn();
const mockSlice = jest.fn((_start?: unknown, _end?: unknown, _type?: unknown) => ({ kind: 'blob' }));

jest.mock('expo/fetch', () => ({ fetch: (...args: unknown[]) => mockFetch(args[0], args[1]) }));
jest.mock('expo-file-system', () => ({
  File: class MockFile {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
    slice(...args: unknown[]) { return mockSlice(args[0], args[1], args[2]); }
  },
}));

// The module must load after the native Expo mocks above.
// eslint-disable-next-line import/first
import { MULTIPART_THRESHOLD, uploadRecording } from '../recording-upload';

function apiMock() {
  return {
    presignRecordingUpload: jest.fn().mockResolvedValue({ upload_url: 'https://s3.example/post', fields: { key: 'recording' }, s3_key: 'recordings/small.mp4' }),
    initiateMultipartUpload: jest.fn().mockResolvedValue({ s3_key: 'recordings/large.mp4', upload_id: 'upload-1' }),
    multipartPartUrl: jest.fn().mockImplementation((_key, _upload, part) => Promise.resolve({ upload_url: `https://s3.example/part-${part}` })),
    completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
    abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
    abandonUpload: jest.fn().mockResolvedValue(undefined),
    createRecording: jest.fn().mockResolvedValue({ recording: { id: 1 } }),
  };
}

describe('uploadRecording', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name.toLowerCase() === 'etag' ? '"etag"' : null },
      text: () => Promise.resolve(''),
    });
  });

  it('publishes a normal video with a presigned form upload', async () => {
    const api = apiMock();
    await uploadRecording({
      api: api as never,
      cohortId: 7,
      asset: { uri: 'file:///small.mp4', name: 'small.mp4', size: 4_000_000, mimeType: 'video/mp4' },
      title: 'Class replay',
    });

    expect(api.presignRecordingUpload).toHaveBeenCalledWith(7, 'small.mp4', 'video/mp4');
    expect(mockFetch).toHaveBeenCalledWith('https://s3.example/post', expect.objectContaining({ method: 'POST' }));
    expect(api.createRecording).toHaveBeenCalledWith(7, expect.objectContaining({ title: 'Class replay', s3_key: 'recordings/small.mp4', publish_immediately: false }));
  });

  it('passes the explicit publish-immediately choice to recording creation', async () => {
    const api = apiMock();
    await uploadRecording({
      api: api as never,
      cohortId: 7,
      asset: { uri: 'file:///small.mp4', name: 'small.mp4', size: 4_000_000, mimeType: 'video/mp4' },
      title: 'Public replay',
      publishImmediately: true,
    });

    expect(api.createRecording).toHaveBeenCalledWith(7, expect.objectContaining({ publish_immediately: true }));
  });

  it('uploads large videos in retryable 16 MB parts before publishing', async () => {
    const api = apiMock();
    await uploadRecording({
      api: api as never,
      cohortId: 7,
      asset: { uri: 'file:///large.mov', name: 'large.mov', size: MULTIPART_THRESHOLD, mimeType: 'video/quicktime' },
      title: 'Large replay',
    });

    expect(api.initiateMultipartUpload).toHaveBeenCalled();
    expect(api.multipartPartUrl).toHaveBeenCalledTimes(7);
    expect(mockSlice).toHaveBeenCalledTimes(7);
    expect(api.completeMultipartUpload).toHaveBeenCalledWith(
      'recordings/large.mp4',
      'upload-1',
      expect.arrayContaining([{ part_number: 1, etag: '"etag"' }]),
    );
  });

  it('removes an uploaded object if publishing the database record fails', async () => {
    const api = apiMock();
    api.createRecording.mockRejectedValue(new Error('Could not publish'));

    await expect(uploadRecording({
      api: api as never,
      cohortId: 7,
      asset: { uri: 'file:///small.mp4', name: 'small.mp4', size: 4_000_000, mimeType: 'video/mp4' },
      title: 'Class replay',
    })).rejects.toThrow('Could not publish');

    expect(api.abandonUpload).toHaveBeenCalledWith('recordings/small.mp4');
  });
});
