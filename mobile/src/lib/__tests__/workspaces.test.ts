import { demoChannels, demoDms, demoWorkspaces } from '../demo-data';
import { buildWorkspaceCards, resolveActiveWorkspaceId } from '../workspaces';

describe('workspace selection', () => {
  it('keeps a preferred workspace only while it remains server-visible', () => {
    expect(resolveActiveWorkspaceId(demoWorkspaces, 2)).toBe(2);
    expect(resolveActiveWorkspaceId(demoWorkspaces, 999)).toBe(1);
    expect(resolveActiveWorkspaceId([], 1)).toBeNull();
  });

  it('keeps counts and unread state isolated by workspace', () => {
    const cards = buildWorkspaceCards(demoWorkspaces, demoChannels, demoDms);
    expect(cards[0]).toMatchObject({ id: 1, channelCount: 2, directMessageCount: 2, unreadCount: 6 });
    expect(cards[1]).toMatchObject({ id: 2, channelCount: 1, directMessageCount: 0, unreadCount: 0 });
  });
});
