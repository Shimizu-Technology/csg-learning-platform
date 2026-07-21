import type { Announcement, ChannelSummary, DirectConversationSummary, Message, SessionUser, WorkspaceSummary } from './types';

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

export const demoUser: SessionUser = {
  id: 7, clerk_id: 'demo', email: 'leon@codeschoolofguam.com', first_name: 'Leon', last_name: 'Shimizu',
  full_name: 'Leon Shimizu', role: 'admin', github_username: 'leonshimizu', avatar_url: null, is_admin: true, is_staff: true,
};

export const demoWorkspaces: WorkspaceSummary[] = [
  { id: 1, name: 'Web Dev Cohort 4', slug: 'web-dev-cohort-4', workspace_type: 'cohort', status: 'active', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', description: 'Workspace for Web Dev Cohort 4', member_count: 12, can_manage: false, created_at: ago(20_000), updated_at: ago(8) },
  { id: 2, name: 'CSG Community', slug: 'csg-community', workspace_type: 'community', status: 'active', cohort_id: null, cohort_name: null, description: 'Code School alumni, opportunities, and community events.', member_count: 46, can_manage: true, created_at: ago(10_000), updated_at: ago(92) },
];

export const demoChannels: ChannelSummary[] = [
  { id: 12, workspace_id: 1, workspace_name: 'Web Dev Cohort 4', workspace_type: 'cohort', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', name: 'general', description: 'Questions, wins, and class-wide updates.', visibility: 'cohort', status: 'active', position: 0, muted: false, unread_count: 3, last_read_at: ago(180), latest_message: { id: 104, body: 'The recording and starter files are up. Great work today.', created_at: ago(8), author_name: 'Leon Shimizu' }, created_at: ago(20_000), updated_at: ago(8) },
  { id: 13, workspace_id: 1, workspace_name: 'Web Dev Cohort 4', workspace_type: 'cohort', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', name: 'help-desk', description: 'Bring your blockers. Leave with a next step.', visibility: 'cohort', status: 'active', position: 1, muted: false, unread_count: 1, last_read_at: ago(240), latest_message: { id: 105, body: 'I found the issue — my route was nested one level too deep.', created_at: ago(34), author_name: 'Maya Santos' }, created_at: ago(20_000), updated_at: ago(34) },
  { id: 14, workspace_id: 2, workspace_name: 'CSG Community', workspace_type: 'community', cohort_id: null, cohort_name: null, name: 'opportunities', description: 'Jobs, internships, events, and ways to keep building.', visibility: 'cohort', status: 'active', position: 0, muted: true, unread_count: 0, last_read_at: ago(60), latest_message: { id: 106, body: 'Guam Code Camp mentor applications close Friday.', created_at: ago(92), author_name: 'Ari Cruz' }, created_at: ago(10_000), updated_at: ago(92) },
];

export const demoDms: DirectConversationSummary[] = [
  { id: 31, workspace_id: 1, workspace_name: 'Web Dev Cohort 4', workspace_type: 'cohort', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', title: 'Maya Santos', status: 'active', muted: false, unread_count: 2, last_read_at: ago(300), latest_message: { id: 203, body: 'Can I send you the repo before office hours?', created_at: ago(16), author_name: 'Maya Santos' }, users: [demoUser, { id: 18, full_name: 'Maya Santos', email: 'maya@example.com', role: 'student', avatar_url: null, is_admin: false, is_staff: false }], created_at: ago(8_000), updated_at: ago(16) },
  { id: 32, workspace_id: 1, workspace_name: 'Web Dev Cohort 4', workspace_type: 'cohort', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', title: 'Noah, Kai', status: 'active', muted: false, unread_count: 0, last_read_at: ago(45), latest_message: { id: 205, body: 'Thursday after class works for both of us.', created_at: ago(46), author_name: 'Kai Perez' }, users: [demoUser], created_at: ago(6_000), updated_at: ago(46) },
];

export const demoMessages: Record<string, Message[]> = {
  'channel:12': [
    { id: 101, channel_id: 12, direct_conversation_id: null, parent_message_id: null, body: 'Before tomorrow, push your latest branch and add one question to the help channel.', mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: ago(400), created_at: ago(420), updated_at: ago(420), mine: true, reactions: [{ emoji: 'check', count: 6, reacted: false, users: [] }], attachments: [], author: demoUser },
    { id: 102, channel_id: 12, direct_conversation_id: null, parent_message_id: null, body: 'The API exercise finally clicked once I drew the request flow out.', mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: null, created_at: ago(65), updated_at: ago(65), mine: false, reactions: [], attachments: [], author: { id: 18, full_name: 'Maya Santos', email: 'maya@example.com', role: 'student', avatar_url: null } },
    { id: 104, channel_id: 12, direct_conversation_id: null, parent_message_id: null, body: 'The recording and starter files are up. Great work today.', mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: null, created_at: ago(8), updated_at: ago(8), mine: true, reactions: [], attachments: [], read_receipts: { count: 8, users: [] }, author: demoUser },
  ],
  'channel:13': [],
  'channel:14': [],
  'dm:31': [
    { id: 201, channel_id: null, direct_conversation_id: 31, parent_message_id: null, body: 'Your component structure is solid. The redirect loop is probably in the layout guard.', mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: null, created_at: ago(40), updated_at: ago(40), mine: true, reactions: [], attachments: [], author: demoUser },
    { id: 203, channel_id: null, direct_conversation_id: 31, parent_message_id: null, body: 'Can I send you the repo before office hours?', mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: null, created_at: ago(16), updated_at: ago(16), mine: false, reactions: [], attachments: [], author: { id: 18, full_name: 'Maya Santos', email: 'maya@example.com', role: 'student', avatar_url: null } },
  ],
  'dm:32': [],
};

export const demoAnnouncements: Announcement[] = [
  { id: 8, title: 'Office hours moved to Thursday', body: 'This week only, office hours will run Thursday from 5:30–7:00 PM in the main classroom. Bring a specific blocker and your latest branch.', pinned: true, published_at: ago(180), audience: 'cohort', status: 'published', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', archived_at: null, read_at: null, created_at: ago(200), updated_at: ago(180), author: demoUser },
  { id: 7, title: 'Deployment week checklist', body: 'Production URLs, environment variables, and final QA are due before Friday standup. Pair up for the release walkthrough.', pinned: false, published_at: ago(2_000), audience: 'cohort', status: 'published', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', archived_at: null, read_at: ago(1_800), created_at: ago(2_100), updated_at: ago(2_000), author: demoUser },
];
