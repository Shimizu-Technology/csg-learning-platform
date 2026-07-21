import { CsgApi, websocketOrigin, websocketUrl } from '../api';

describe('CsgApi', () => {
  afterEach(() => jest.restoreAllMocks());

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

  it('unregisters a device with an encoded query parameter and no DELETE body', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    await new CsgApi(async () => 'session-token').unregisterDevice('ExpoPushToken[a+b]');

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('token=ExpoPushToken%5Ba%2Bb%5D'), expect.objectContaining({ method: 'DELETE' }));
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('body');
  });
});

describe('websocketUrl', () => {
  it('uses a websocket scheme and escapes the single-use token', () => {
    expect(websocketUrl('a+b/c')).toMatch(/^ws:\/\/.*\/cable\?token=a%2Bb%2Fc$/);
    expect(websocketOrigin()).toMatch(/^http:\/\//);
  });
});
