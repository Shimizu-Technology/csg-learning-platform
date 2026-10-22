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
    jest.useRealTimers();
    jest.restoreAllMocks();
    mockExpoFetch.mockReset();
  });

  it('keeps the longer GitHub access timeout after an authentication retry', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
      .mockImplementationOnce((_url, options) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response(JSON.stringify({ organization: 'alumni', statuses: {} }), { status: 200 })), 21_000);
        options?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('The request was aborted'), { name: 'AbortError' }));
        }, { once: true });
      }));

    const request = new CsgApi(async () => 'session-token').cohortGithubAccess(4);
    await jest.advanceTimersByTimeAsync(21_000);

    await expect(request).resolves.toEqual({ organization: 'alumni', statuses: {} });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the existing private meeting endpoints without retrying conflicts', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ cohorts: [], booking: { id: 4 } }), { status: 200 }));
    const api = new CsgApi(async () => 'session-token');
    await api.privateMeetings(); await api.bookPrivateMeeting(11); await api.reschedulePrivateMeeting(4, 12); await api.cancelPrivateMeeting(4);
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url).split('/api/v1')[1], init?.method || 'GET', init?.body])).toEqual([
      ['/private_meetings', 'GET', undefined], ['/private_meetings', 'POST', '{"slot_id":11}'], ['/private_meetings/4', 'PATCH', '{"slot_id":12}'], ['/private_meetings/4', 'DELETE', undefined],
    ]);
    fetchMock.mockClear().mockResolvedValue(new Response(JSON.stringify({ error: 'Taken' }), { status: 409 }));
    await expect(api.bookPrivateMeeting(11)).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requests explicit cohort feeds and publishes only the exact cohort recording', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ recording: { id: 9, status: 'published' }, activity_events: [] }), { status: 200 }));
    const api = new CsgApi(async () => 'session-token');
    await api.activityEvents({ feed: 'cohort', cohort_id: 2, user_id: 20, category: 'learning', before_id: 10 });
    await api.publishRecording(2, 9);
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url).split('/api/v1')[1], init?.method || 'GET', init?.body])).toEqual([
      ['/activity_events?feed=cohort&cohort_id=2&user_id=20&category=learning&before_id=10', 'GET', undefined],
      ['/cohorts/2/recordings/9', 'PATCH', '{"status":"published"}'],
    ]);
  });

  it('requests scoped activity and course files and obtains each ZIP URL with a fresh POST', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ resources: [], activity_events: [], url: 'https://example.com/signed.zip' }), { status: 200 }));
    const api = new CsgApi(async () => 'session-token');
    await api.activityEvents({ user_id: 20, cohort_id: 4, category: 'work', before_id: 10 });
    await api.resources();
    await api.recordings(undefined, 4);
    await api.downloadCurriculumResource(6, 2);
    await api.downloadCurriculumResource(6, 2);
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url).split('/api/v1')[1], init?.method || 'GET'])).toEqual([
      ['/activity_events?user_id=20&cohort_id=4&category=work&before_id=10', 'GET'],
      ['/resources?include_course_files=true', 'GET'],
      ['/recordings?cohort_id=4', 'GET'],
      ['/curricula/6/resources/2/download', 'POST'], ['/curricula/6/resources/2/download', 'POST'],
    ]);
  });

  it('adds a Clerk bearer token and parses JSON', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ channels: [] }), { status: 200 }));
    const api = new CsgApi(async () => 'session-token');

    await expect(api.channels()).resolves.toEqual({ channels: [] });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/channels'), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
    }));
  });

  it('requests newer conversation pages after the supplied message', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ messages: [] }), { status: 200 }));
    const api = new CsgApi(async () => 'session-token');

    await api.channel(12, { after_message_id: 90 });
    await api.directConversation(34, { after_message_id: 80 });

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringMatching(/\/api\/v1\/channels\/12\?after_message_id=90$/),
      expect.stringMatching(/\/api\/v1\/direct_conversations\/34\?after_message_id=80$/),
    ]);
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

  it('sends cohort context for student lesson evidence', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response('{}', { status: 200 }));
    const api = new CsgApi(async () => 'session-token');

    await api.lesson(8, undefined, 4);
    await api.progress(8, undefined, 4);
    await api.updateProgress(9, 'completed', 4);
    await api.createSubmission({ content_block_id: 9, text: 'My work' }, 4);
    await api.updateSubmission(11, { text: 'Updated work' }, 4);
    await api.attemptKnowledgeCheck(12, 2, 4);
    await api.contentVideoStream(9, undefined, 4);
    await api.updateContentVideoProgress(9, { last_position_seconds: 30, total_watched_seconds: 25, duration_seconds: 120 }, 4);

    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v1/lessons/8?cohort_id=4');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/v1/progress?lesson_id=8&cohort_id=4');
    expect(fetchMock.mock.calls[2][1]).toEqual(expect.objectContaining({ body: JSON.stringify({ content_block_id: 9, status: 'completed', cohort_id: 4 }) }));
    expect(fetchMock.mock.calls[3][1]).toEqual(expect.objectContaining({ body: JSON.stringify({ content_block_id: 9, text: 'My work', cohort_id: 4 }) }));
    expect(fetchMock.mock.calls[4][1]).toEqual(expect.objectContaining({ body: JSON.stringify({ text: 'Updated work', cohort_id: 4 }) }));
    expect(fetchMock.mock.calls[5][1]).toEqual(expect.objectContaining({ body: JSON.stringify({ selected_option: 2, cohort_id: 4 }) }));
    expect(String(fetchMock.mock.calls[6][0])).toContain('/api/v1/content_blocks/9/video_stream?cohort_id=4');
    expect(fetchMock.mock.calls[7][1]).toEqual(expect.objectContaining({ body: JSON.stringify({ last_position_seconds: 30, total_watched_seconds: 25, duration_seconds: 120, cohort_id: 4 }) }));
  });

  it('creates a first-class hosted recording', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ recording: { id: 12 } }), { status: 201 }));
    const api = new CsgApi(async () => 'session-token');
    const input = { title: 'Week 1 replay', source_url: 'https://youtu.be/abc123def45', publish_immediately: false };

    await api.createExternalRecording(4, input);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/cohorts/4/recordings'), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(input),
    }));
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
    await api.gradeSubmission(9, 'A', 'Clear work', '2026-09-06T01:02:03.000Z');

    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/progress/student/18?cohort_id=4');
    expect(fetchMock.mock.calls[1][0]).toContain('user_id=18&ungraded=true');
    expect(fetchMock.mock.calls[2][0]).toContain('/api/v1/submissions/9');
    expect(fetchMock.mock.calls[3][1]).toEqual(expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ grade: 'A', feedback: 'Clear work', base_submission_updated_at: '2026-09-06T01:02:03.000Z' }) }));
  });

  it('sends the complete native rubric review contract and exposes server validation failures', async () => {
    const criteria = [{ rubric_criterion_id: 12, rating: 'meets' as const, feedback: 'All cases pass' }];
    const version = '2026-10-22T01:02:03.123456Z';
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ submission: { id: 9, grade: 'B', rubric: { criteria } } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: ['Rate every rubric criterion before grading'] }), { status: 422 }));
    const api = new CsgApi(async () => 'session-token');
    await expect(api.gradeSubmission(9, 'B', 'Clear work', version, criteria)).resolves.toMatchObject({ submission: { id: 9, grade: 'B' } });
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ grade: 'B', feedback: 'Clear work', base_submission_updated_at: version, criterion_results: criteria }) }));
    await expect(api.gradeSubmission(9, 'A', 'Incomplete review', version, [])).rejects.toMatchObject({ status: 422, message: 'Rate every rubric criterion before grading' });
  });

  it('loads the staff curriculum library and one detailed curriculum', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ curricula: [{ id: 3 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ curriculum: { id: 3, modules: [] } }), { status: 200 }));
    const api = new CsgApi(async () => 'session-token');

    await api.curricula();
    await api.curriculum(3);

    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/curricula');
    expect(fetchMock.mock.calls[1][0]).toContain('/api/v1/curricula/3');
  });

  it('saves the atomic lesson editor contract with its concurrency version', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ lesson: { id: 101 } }), { status: 200 }));
    const input = {
      base_updated_at: '2026-09-12T01:02:03.123456Z',
      title: 'Responsive Grid',
      required: true,
      requires_submission: true,
      exercise: { id: 203, title: 'Responsive Grid', body: 'Build it.', solution: 'Use Grid.', filename: 'styles.css', submission_type: 'text_submission' as const, submission_config: {}, rubric_id: null },
      alignments: [{ learning_objective_id: 9, content_block_id: 203 }],
    };

    await new CsgApi(async () => 'session-token').updateLessonEditor(101, input);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/lessons/101/editor'), expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ editor: input }),
    }));
  });

  it('uses versioned curriculum structure mutations', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ module: { id: 12 } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ module: { id: 12 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ lesson: { id: 101 } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ lesson: { id: 101 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ lesson: { id: 101 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ lesson: { id: 101 } }), { status: 200 }));
    const api = new CsgApi(async () => 'session-token');
    const moduleInput = { name: 'Live Class', module_type: 'live_class', description: '', position: 0, total_days: 0, day_offset: 0, schedule_days: 'weekdays', base_updated_at: '2026-09-12T01:02:03.123456Z' };
    const exerciseInput = { title: 'Grid', release_day: 9, required: true, instructions: 'Build it.', submission_type: 'manual_complete' as const };

    await api.createCurriculumModule(3, moduleInput);
    await api.updateCurriculumModule(12, moduleInput);
    await api.createExercise(12, exerciseInput);
    await api.updateLessonSchedule(101, 9, '2026-09-12T01:02:03.123456Z');
    await api.archiveLesson(101, '2026-09-12T01:02:04.123456Z');
    await api.restoreLesson(101, '2026-09-12T01:02:05.123456Z');

    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/curricula/3/modules');
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'POST', body: JSON.stringify(moduleInput) }));
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'PATCH', body: JSON.stringify(moduleInput) }));
    expect(fetchMock.mock.calls[2][1]).toEqual(expect.objectContaining({ method: 'POST', body: JSON.stringify(exerciseInput) }));
    expect(fetchMock.mock.calls[3][1]).toEqual(expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ release_day: 9, base_updated_at: '2026-09-12T01:02:03.123456Z' }) }));
    expect(fetchMock.mock.calls[4][1]).toEqual(expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ base_updated_at: '2026-09-12T01:02:04.123456Z' }) }));
    expect(fetchMock.mock.calls[5][0]).toContain('/api/v1/lessons/101/restore');
    expect(fetchMock.mock.calls[5][1]).toEqual(expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ base_updated_at: '2026-09-12T01:02:05.123456Z' }) }));
  });

  it('presigns normal and multipart lesson video uploads against the exact block', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ upload_url: 'https://storage.example', fields: {}, s3_key: 'content_videos/video.mp4', upload_id: 'upload-1' }), { status: 200 }));
    const api = new CsgApi(async () => 'session-token');

    await api.presignContentVideoUpload(42, 'lesson.mp4', 'video/mp4');
    await api.presignContentVideoUpload(undefined, 'new-lesson.mp4', 'video/mp4');
    await api.initiateContentVideoMultipartUpload(42, 'large.mov', 'video/quicktime', 200_000_000);

    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/content_blocks/42/video_presign');
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'POST', body: JSON.stringify({ filename: 'lesson.mp4', content_type: 'video/mp4' }) }));
    expect(fetchMock.mock.calls[1][0]).toContain('/api/v1/video_presign');
    expect(fetchMock.mock.calls[2][0]).toContain('/api/v1/uploads/multipart/initiate');
    expect(fetchMock.mock.calls[2][1]).toEqual(expect.objectContaining({ method: 'POST', body: JSON.stringify({ content_block_id: 42, filename: 'large.mov', content_type: 'video/quicktime', file_size: 200_000_000 }) }));
  });

  it('loads and creates reusable learning-design resources', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response('{}', { status: 200 }));
    const api = new CsgApi(async () => 'session-token');
    const objective = { curriculum_id: 3, code: 'CSS.4', title: 'Build layouts', description: 'Responsive systems', success_criteria: 'I can build a flexible layout.', position: 2 };
    const rubric = { curriculum_id: 3, title: 'Project quality', description: 'Shared expectations', criteria: [{ title: 'Responsive', description: 'Reflows cleanly.' }] };

    await api.learningObjectives(3);
    await api.createLearningObjective(objective);
    await api.rubrics(3);
    await api.createRubric(rubric);

    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/learning_objectives?curriculum_id=3');
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: 'POST', body: JSON.stringify({ learning_objective: objective }) }));
    expect(fetchMock.mock.calls[2][0]).toContain('/api/v1/rubrics?curriculum_id=3');
    expect(fetchMock.mock.calls[3][1]).toEqual(expect.objectContaining({ method: 'POST', body: JSON.stringify({ rubric }) }));
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


test('stale cohort context cannot authorize writes and unlocks only after revalidation', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response('{}', { status: 200 }));
  const api = new CsgApi(async () => 'token');
  try {
    api.setCohortContextReadOnly(true);
    await expect(api.request('/api/v1/progress', { method: 'POST' })).rejects.toMatchObject({ code: 'stale_cohort_context' });
    await expect(api.request('/api/v1/submissions/1', { method: 'PATCH' })).rejects.toMatchObject({ code: 'stale_cohort_context' });
    await expect(api.transcribeVoice('file://draft.m4a', 'message')).rejects.toMatchObject({ code: 'stale_cohort_context' });
    expect(fetchMock).not.toHaveBeenCalled();
    await api.accessibleCohorts();
    await api.session();
    await api.unregisterDevice('old-token');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    api.setCohortContextReadOnly(false);
    await api.request('/api/v1/progress', { method: 'POST' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  } finally { fetchMock.mockRestore(); }
});
