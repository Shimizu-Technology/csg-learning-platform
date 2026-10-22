import { demoChannels, demoDms, demoWorkspaces } from '../demo-data';
import { buildWorkspaceCards, resolveActiveWorkspaceId, workspaceIdForCohort } from '../workspaces';

describe('workspace selection', () => {
  it('keeps a preferred workspace only while it remains server-visible', () => {
    expect(resolveActiveWorkspaceId(demoWorkspaces, 2)).toBe(2);
    expect(resolveActiveWorkspaceId(demoWorkspaces, 999)).toBe(1);
    expect(resolveActiveWorkspaceId([], 1)).toBeNull();
  });

  it('keeps counts and unread state isolated by workspace', () => {
    const cards = buildWorkspaceCards(demoWorkspaces, demoChannels, demoDms);
    expect(cards.find((workspace) => workspace.id === 1)).toMatchObject({ channelCount: 2, directMessageCount: 2, unreadCount: 6 });
    expect(cards.find((workspace) => workspace.id === 2)).toMatchObject({ channelCount: 1, directMessageCount: 0, unreadCount: 0 });
  });

  it('uses the same attention policy for workspace and tab badges with muted-only unread', () => {
    const channels = demoChannels.map((channel) => ({ ...channel, muted: true, unread_count: 5 }));
    const dms = demoDms.map((dm) => ({ ...dm, muted: true, unread_count: 3 }));
    expect(buildWorkspaceCards(demoWorkspaces, channels, dms).every((card) => card.unreadCount === 0)).toBe(true);
  });

  it('maps the global cohort to its messaging workspace without treating community as a cohort', () => {
    expect(workspaceIdForCohort(demoWorkspaces, 4)).toBe(1);
    expect(workspaceIdForCohort(demoWorkspaces, null)).toBeNull();
    expect(workspaceIdForCohort(demoWorkspaces, 999)).toBeNull();
  });
});
