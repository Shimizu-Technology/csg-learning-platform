const mockExpoFetch = jest.fn();

jest.mock('expo/fetch', () => ({ fetch: (...args: unknown[]) => mockExpoFetch(args[0], args[1]) }));
jest.mock('expo-file-system', () => ({
  File: class MockFile {
    uri: string;
    constructor(uri: string) { this.uri = uri; }
  },
}));

// The API module must load after the native Expo mocks above.
// eslint-disable-next-line import/first
import { CsgApi, websocketOrigin, websocketUrl } from '../api';

describe('CsgApi', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockExpoFetch.mockReset();
  });

  it('adds a Clerk bearer token and parses JSON', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ channels: [] }), { status: 200 }));
    const api = new CsgApi(async () => 'session-token');

    await expect(api.channels()).resolves.toEqual({ channels: [] });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/channels'), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
    }));
  });

  it('refreshes the token once after an unauthorized response', async () => {
    const getToken = jest.fn(async ({ skipCache }: { skipCache?: boolean } = {}) => skipCache ? 'fresh-token' : 'old-token');
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ channels: [] }), { status: 200 }));

    await new CsgApi(getToken).channels();
    expect(getToken).toHaveBeenNthCalledWith(2, { skipCache: true });
  });

  it('can safely retry the idempotent session sync after a 401', async () => {
    const getToken = jest.fn(async ({ skipCache }: { skipCache?: boolean } = {}) => skipCache ? 'fresh-token' : 'old-token');
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 1 } }), { status: 200 }));

    await expect(new CsgApi(getToken).session()).resolves.toEqual({ user: { id: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }),
    }));
  });

  it('preserves structured access-denial details from the API', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: 'This account does not have access.',
      code: 'account_not_authorized',
    }), { status: 403 }));

    await expect(new CsgApi(async () => 'session-token').session()).rejects.toMatchObject({
      status: 403,
      code: 'account_not_authorized',
    });
  });

  it('unregisters a device with an encoded query parameter and no DELETE body', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    await new CsgApi(async () => 'session-token').unregisterDevice('ExpoPushToken[a+b]');

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('token=ExpoPushToken%5Ba%2Bb%5D'), expect.objectContaining({ method: 'DELETE' }));
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('body');
  });

  it('creates a secure web handoff with a relative allowlisted destination', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ url: 'https://accounts.example.com/one-time' }), { status: 200 }));

    await expect(new CsgApi(async () => 'session-token').webHandoff('/lessons/42')).resolves.toEqual({ url: 'https://accounts.example.com/one-time' });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/web_handoffs'), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ destination: '/lessons/42' }),
    }));
  });

  it('uses the shared recording and lesson-video progress contracts', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ stream_url: 'https://signed.example/video.mp4', expires_at: '2026-07-21T02:00:00Z' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ watch_progress: { recording_id: 7 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ video_progress: { content_block_id: 9 } }), { status: 200 }));
    const api = new CsgApi(async () => 'session-token');

    await api.recordings();
    await api.recordingStream(4, 7);
    await api.updateWatchProgress(7, { last_position_seconds: 20, total_watched_seconds: 18, duration_seconds: 100 });
    await api.updateContentVideoProgress(9, { last_position_seconds: 30, total_watched_seconds: 25, duration_seconds: 120 });

    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/recordings');
    expect(fetchMock.mock.calls[1][0]).toContain('/api/v1/cohorts/4/recordings/7/stream_url');
    expect(fetchMock.mock.calls[2][1]).toEqual(expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ recording_id: 7, last_position_seconds: 20, total_watched_seconds: 18, duration_seconds: 100 }) }));
    expect(fetchMock.mock.calls[3][0]).toContain('/api/v1/content_blocks/9/video_progress');
  });

  it('uses staff-scoped progress, submission, and grading endpoints', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ overall_progress: { percentage: 40 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ submissions: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ submission: { id: 9 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ submission: { id: 9, grade: 'A' } }), { status: 200 }));
    const api = new CsgApi(async () => 'session-token');

    await api.studentProgress(18, 4);
    await api.submissions({ user_id: 18, ungraded: true });
    await api.submission(9);
    await api.gradeSubmission(9, 'A', 'Clear work');

    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/progress/student/18?cohort_id=4');
    expect(fetchMock.mock.calls[1][0]).toContain('user_id=18&ungraded=true');
    expect(fetchMock.mock.calls[2][0]).toContain('/api/v1/submissions/9');
    expect(fetchMock.mock.calls[3][1]).toEqual(expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ grade: 'A', feedback: 'Clear work' }) }));
  });

  it('loads a stable help request record', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ help_request: { id: 12 } }), { status: 200 }));
    await new CsgApi(async () => 'session-token').helpRequest(12);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/help_requests/12');
  });

  it('loads and updates a stable intervention record', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ intervention: { id: 61 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ intervention: { id: 61, status: 'contacted' } }), { status: 200 }));
    const api = new CsgApi(async () => 'session-token');
    await api.intervention(61);
    await api.updateIntervention(61, { status: 'contacted' });
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/interventions/61');
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ intervention: { status: 'contacted' } }) }));
  });

  it('creates a direct conversation in the requested cohort workspace', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ direct_conversation: { id: 31 } }), { status: 200 }));

    await new CsgApi(async () => 'session-token').createCohortDm(4, [18]);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/direct_conversations'), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ cohort_id: 4, user_ids: [18] }),
    }));
  });

  it('uploads a voice draft with authorization and the review-only contract', async () => {
    mockExpoFetch.mockResolvedValue(new Response(JSON.stringify({
      raw_text: 'hello there',
      suggested_text: 'Hello there.',
      duration_seconds: 2,
      warnings: [],
    }), { status: 200 }));

    await expect(new CsgApi(async () => 'session-token').transcribeVoice('file:///voice.m4a', 'thread')).resolves.toMatchObject({
      raw_text: 'hello there',
      suggested_text: 'Hello there.',
    });

    expect(mockExpoFetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/transcriptions'), expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer session-token' },
      body: expect.any(FormData),
    }));
    const form = mockExpoFetch.mock.calls[0][1].body as FormData;
    expect(form.get('surface')).toBe('thread');
  });

  it('refreshes a voice request token once after a 401', async () => {
    const getToken = jest.fn(async ({ skipCache }: { skipCache?: boolean } = {}) => skipCache ? 'fresh-token' : 'old-token');
    mockExpoFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ raw_text: 'Hi', suggested_text: 'Hi.', duration_seconds: 1, warnings: [] }), { status: 200 }));

    await expect(new CsgApi(getToken).transcribeVoice('file:///voice.m4a')).resolves.toMatchObject({ suggested_text: 'Hi.' });
    expect(getToken).toHaveBeenNthCalledWith(2, { skipCache: true });
    expect(mockExpoFetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
      headers: { Authorization: 'Bearer fresh-token' },
    }));
  });
});

describe('websocketUrl', () => {
  it('uses a websocket scheme and escapes the single-use token', () => {
    expect(websocketUrl('a+b/c')).toMatch(/^ws:\/\/.*\/cable\?token=a%2Bb%2Fc$/);
    expect(websocketOrigin()).toMatch(/^http:\/\//);
  });
});
