import { withoutPrivateNotifications, createLearningPersister, createRetryableInitializer, learningCacheKey } from '../learning-cache';
import { activateUserStorage, beginUserStorageCleanup } from '../user-storage-lifecycle';

const persistedClient = {
  buster: '',
  timestamp: 1,
  clientState: { mutations: [], queries: [] },
};

describe('learning cache', () => {
  it('scopes persisted learning data by version and Rails user', () => {
    expect(learningCacheKey(42)).toBe('learning-v1:user:42');
    expect(learningCacheKey(42)).not.toBe(learningCacheKey(43));
  });

  it('retries database initialization after a transient open failure', async () => {
    const database = { ready: true };
    const open = jest.fn()
      .mockRejectedValueOnce(new Error('disk temporarily unavailable'))
      .mockResolvedValue(database);
    const initialize = createRetryableInitializer(open);

    await expect(initialize()).rejects.toThrow('disk temporarily unavailable');
    await expect(initialize()).resolves.toBe(database);
    await expect(initialize()).resolves.toBe(database);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('abandons cache operations from a superseded storage generation', async () => {
    const userId = 92;
    activateUserStorage(userId);
    let releaseDatabase = () => {};
    const databaseGate = new Promise<void>((resolve) => { releaseDatabase = resolve; });
    const staleDatabase = { runAsync: jest.fn(), getFirstAsync: jest.fn() };
    const stalePersister = createLearningPersister(userId, async () => {
      await databaseGate;
      return staleDatabase;
    });

    const stalePersist = stalePersister.persistClient(persistedClient);
    const staleRestore = stalePersister.restoreClient();
    beginUserStorageCleanup(userId);
    activateUserStorage(userId);

    const currentDatabase = { runAsync: jest.fn().mockResolvedValue(undefined), getFirstAsync: jest.fn() };
    const currentPersister = createLearningPersister(userId, async () => currentDatabase);
    await currentPersister.persistClient({ ...persistedClient, timestamp: 2 });
    releaseDatabase();

    await stalePersist;
    await expect(staleRestore).resolves.toBeUndefined();
    expect(staleDatabase.runAsync).not.toHaveBeenCalled();
    expect(staleDatabase.getFirstAsync).not.toHaveBeenCalled();
    expect(currentDatabase.runAsync).toHaveBeenCalledTimes(1);
  });
});

test('file review notifications never reach the offline cache', () => {
  const notice = (id: number, type: string) => ({ id, notification_type: type, title: 'x' });
  const client = { timestamp: 1, buster: 'b', clientState: { mutations: [], queries: [
    { queryKey: ['updates', 3, 'notifications', 'pages'], queryHash: 'n', state: { data: { pages: [{ notifications: [notice(1, 'cohort_file'), notice(2, 'message')], unread_count: 2 }], pageParams: [1] } } },
    { queryKey: ['learning', 3, 'resources'], queryHash: 'r', state: { data: { notifications: [notice(3, 'cohort_file')] } } },
  ] } } as unknown as Parameters<typeof withoutPrivateNotifications>[0];
  const kept = withoutPrivateNotifications(client).clientState.queries;
  expect((kept[0].state.data as { pages: { notifications: { id: number }[] }[] }).pages[0].notifications.map((item) => item.id)).toEqual([2]);
  expect(kept[1]).toBe(client.clientState.queries[1]);
});
