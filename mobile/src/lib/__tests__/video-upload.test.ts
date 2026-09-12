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

// Native Expo modules must be mocked before loading the uploader.
// eslint-disable-next-line import/first
import { MULTIPART_VIDEO_THRESHOLD, uploadVideoToStorage } from '../video-upload';

function apiMock() {
  return {
    presignContentVideoUpload: jest.fn().mockResolvedValue({ upload_url: 'https://s3.example/post', fields: { key: 'lesson' }, s3_key: 'content_videos/small.mp4' }),
    initiateContentVideoMultipartUpload: jest.fn().mockResolvedValue({ s3_key: 'content_videos/large.mov', upload_id: 'lesson-upload-1' }),
    multipartPartUrl: jest.fn().mockImplementation((_key, _upload, part) => Promise.resolve({ upload_url: `https://s3.example/part-${part}` })),
    completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
    abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
  };
}

describe('lesson video storage upload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 200, headers: { get: () => '"etag"' }, text: () => Promise.resolve('') });
  });

  afterEach(() => jest.useRealTimers());

  it('uploads a normal lesson video through a content-block presign', async () => {
    const api = apiMock();
    const result = await uploadVideoToStorage({ api: api as never, asset: { uri: 'file:///lesson.mp4', name: 'lesson.mp4', size: 4_000_000, mimeType: 'video/mp4' }, target: { kind: 'lesson', contentBlockId: 42 } });

    expect(result).toBe('content_videos/small.mp4');
    expect(api.presignContentVideoUpload).toHaveBeenCalledWith(42, 'lesson.mp4', 'video/mp4');
    expect(mockFetch).toHaveBeenCalledWith('https://s3.example/post', expect.objectContaining({ method: 'POST' }));
  });

  it('uses generic multipart lesson storage when the lesson has no video block yet', async () => {
    const api = apiMock();
    await uploadVideoToStorage({ api: api as never, asset: { uri: 'file:///lesson.mov', name: 'lesson.mov', size: MULTIPART_VIDEO_THRESHOLD, mimeType: 'video/quicktime' }, target: { kind: 'lesson' } });

    expect(api.initiateContentVideoMultipartUpload).toHaveBeenCalledWith(undefined, 'lesson.mov', 'video/quicktime', MULTIPART_VIDEO_THRESHOLD);
    expect(api.multipartPartUrl).toHaveBeenCalledTimes(7);
    expect(api.completeMultipartUpload).toHaveBeenCalledWith('content_videos/large.mov', 'lesson-upload-1', expect.arrayContaining([{ part_number: 1, etag: '"etag"' }]));
  });

  it('aborts a multipart upload when a part cannot be stored', async () => {
    jest.useFakeTimers();
    const api = apiMock();
    mockFetch.mockResolvedValue({ ok: false, status: 503, headers: { get: () => null }, text: () => Promise.resolve('<Code>SlowDown</Code>') });
    const pending = uploadVideoToStorage({ api: api as never, asset: { uri: 'file:///lesson.mov', name: 'lesson.mov', size: MULTIPART_VIDEO_THRESHOLD, mimeType: 'video/quicktime' }, target: { kind: 'lesson', contentBlockId: 42 } });
    const rejection = expect(pending).rejects.toThrow('SlowDown');
    await jest.runAllTimersAsync();

    await rejection;
    expect(api.abortMultipartUpload).toHaveBeenCalledWith('content_videos/large.mov', 'lesson-upload-1');
  });
});
