import type { Announcement, AppNotification, ChannelSummary, DirectConversationSummary, Message, SessionUser, UserSummary, WorkspaceSummary } from './types';

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const formattedDemoMessage = '**Command recap**\n\n```sh\nls - list\ncd <folder name> - change directory\ncd .. - go back a folder\ncurl https://learn.codeschoolofguam.com/lesson/101 # END-OF-LONG-LINE\n```\n\n- `mkdir project` creates a folder\n- [Open the guide](https://example.com)\n\n> Tab completion saves time.';

export const demoAdminUser: SessionUser = {
  id: 7, clerk_id: 'demo', email: 'leon@codeschoolofguam.com', first_name: 'Leon', last_name: 'Shimizu',
  full_name: 'Leon Shimizu', role: 'admin', github_username: 'leonshimizu', avatar_url: null, is_admin: true, is_staff: true,
};

export const demoStudentUser: SessionUser = {
  id: 23, clerk_id: 'demo-student', email: 'noah@example.com', first_name: 'Noah', last_name: 'Cruz',
  full_name: 'Noah Cruz', role: 'student', github_username: 'noahcruz', avatar_url: null, is_admin: false, is_staff: false,
};

const demoMaya: UserSummary = { id: 18, full_name: 'Maya Santos', email: 'maya@example.com', role: 'student', avatar_url: null, is_admin: false, is_staff: false };
const demoKai: UserSummary = { id: 29, full_name: 'Kai Perez', email: 'kai@example.com', role: 'student', avatar_url: null, is_admin: false, is_staff: false };
export const demoUser = process.env.EXPO_PUBLIC_DEMO_ROLE === 'student' ? demoStudentUser : demoAdminUser;
export const demoPeople: UserSummary[] = [demoAdminUser, demoStudentUser, demoMaya, demoKai];
const demoDmPartner = demoUser.is_staff ? demoMaya : demoAdminUser;

export const demoWorkspaces: WorkspaceSummary[] = [
  { id: 1, name: 'Web Dev Cohort 4', slug: 'web-dev-cohort-4', workspace_type: 'cohort', status: 'active', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', description: 'Workspace for Web Dev Cohort 4', member_count: 12, can_manage: false, created_at: ago(20_000), updated_at: ago(8) },
  { id: 2, name: 'CSG Community', slug: 'csg-community', workspace_type: 'community', status: 'active', cohort_id: null, cohort_name: null, description: 'Code School alumni, opportunities, and community events.', member_count: 46, can_manage: demoUser.is_staff, created_at: ago(10_000), updated_at: ago(92) },
];

export const demoChannels: ChannelSummary[] = [
  { id: 12, workspace_id: 1, workspace_name: 'Web Dev Cohort 4', workspace_type: 'cohort', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', name: 'general', description: 'Questions, wins, and class-wide updates.', visibility: 'cohort', status: 'active', position: 0, muted: false, unread_count: 3, last_read_at: ago(180), latest_message: { id: 104, body: formattedDemoMessage, created_at: ago(8), author_name: 'Leon Shimizu' }, created_at: ago(20_000), updated_at: ago(8) },
  { id: 13, workspace_id: 1, workspace_name: 'Web Dev Cohort 4', workspace_type: 'cohort', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', name: 'help-desk', description: 'Bring your blockers. Leave with a next step.', visibility: 'cohort', status: 'active', position: 1, muted: false, unread_count: 1, last_read_at: ago(240), latest_message: { id: 105, body: 'I found the issue — my route was nested one level too deep.', created_at: ago(34), author_name: 'Maya Santos' }, created_at: ago(20_000), updated_at: ago(34) },
  { id: 14, workspace_id: 2, workspace_name: 'CSG Community', workspace_type: 'community', cohort_id: null, cohort_name: null, name: 'opportunities', description: 'Jobs, internships, events, and ways to keep building.', visibility: 'cohort', status: 'active', position: 0, muted: true, unread_count: 0, last_read_at: ago(60), latest_message: { id: 106, body: 'Guam Code Camp mentor applications close Friday.', created_at: ago(92), author_name: 'Ari Cruz' }, created_at: ago(10_000), updated_at: ago(92) },
];

export const demoDms: DirectConversationSummary[] = [
  { id: 31, workspace_id: 1, workspace_name: 'Web Dev Cohort 4', workspace_type: 'cohort', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', title: demoDmPartner.full_name, status: 'active', muted: false, unread_count: 2, last_read_at: ago(300), latest_message: { id: 203, body: demoUser.is_staff ? 'Can I send you the repo before office hours?' : 'The redirect loop is probably in the layout guard.', created_at: ago(16), author_name: demoDmPartner.full_name }, users: [demoUser, demoDmPartner], created_at: ago(8_000), updated_at: ago(16) },
  { id: 32, workspace_id: 1, workspace_name: 'Web Dev Cohort 4', workspace_type: 'cohort', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', title: demoUser.is_staff ? 'Noah, Kai' : 'Leon, Kai', status: 'active', muted: false, unread_count: 0, last_read_at: ago(45), latest_message: { id: 205, body: 'Thursday after class works for both of us.', created_at: ago(46), author_name: 'Kai Perez' }, users: demoUser.is_staff ? [demoUser, demoStudentUser, demoKai] : [demoUser, demoAdminUser, demoKai], created_at: ago(6_000), updated_at: ago(46) },
];

export const demoMessages: Record<string, Message[]> = {
  'channel:12': [
    { id: 101, channel_id: 12, direct_conversation_id: null, parent_message_id: null, body: 'Before tomorrow, push your latest branch and add one question to the help channel.', mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: ago(400), created_at: ago(420), updated_at: ago(420), mine: demoUser.id === demoAdminUser.id, reactions: [{ emoji: '✅', count: 3, reacted: demoUser.id === demoStudentUser.id, users: [{ id: 18, full_name: 'Maya Santos', avatar_url: null }, { id: 23, full_name: 'Noah Cruz', avatar_url: null }, { id: 29, full_name: 'Kai Perez', avatar_url: null }] }], attachments: [], author: demoAdminUser },
    { id: 102, channel_id: 12, direct_conversation_id: null, parent_message_id: null, body: 'The API exercise finally clicked once I drew the request flow out.', mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: null, created_at: ago(65), updated_at: ago(65), mine: demoUser.id === demoMaya.id, reactions: [], attachments: [], author: demoMaya },
    { id: 104, channel_id: 12, direct_conversation_id: null, parent_message_id: null, body: formattedDemoMessage, mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: null, created_at: ago(8), updated_at: ago(8), mine: demoUser.id === demoAdminUser.id, reactions: [], attachments: [], read_receipts: { count: 8, users: [] }, author: demoAdminUser },
  ],
  'channel:13': [],
  'channel:14': [],
  'dm:31': [
    { id: 201, channel_id: null, direct_conversation_id: 31, parent_message_id: null, body: demoUser.is_staff ? 'Your component structure is solid. The redirect loop is probably in the layout guard.' : 'Can I send you the repo before office hours?', mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: null, created_at: ago(40), updated_at: ago(40), mine: true, reactions: [], attachments: [], author: demoUser },
    { id: 203, channel_id: null, direct_conversation_id: 31, parent_message_id: null, body: demoUser.is_staff ? 'Can I send you the repo before office hours?' : 'Your component structure is solid. The redirect loop is probably in the layout guard.', mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: null, created_at: ago(16), updated_at: ago(16), mine: false, reactions: [], attachments: [], author: demoDmPartner },
  ],
  'dm:32': [
    { id: 204, channel_id: null, direct_conversation_id: 32, parent_message_id: null, body: 'Would Thursday after class work for a quick project check-in?', mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: null, created_at: ago(52), updated_at: ago(52), mine: true, reactions: [], attachments: [], author: demoUser },
    { id: 205, channel_id: null, direct_conversation_id: 32, parent_message_id: null, body: 'Thursday after class works for both of us.', mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: null, created_at: ago(46), updated_at: ago(46), mine: false, reactions: [], attachments: [], author: demoKai },
  ],
};

export const demoAnnouncements: Announcement[] = [
  { id: 8, title: 'Office hours moved to Thursday', body: 'This week only, office hours will run Thursday from 5:30–7:00 PM in the main classroom. Bring a specific blocker and your latest branch.', pinned: true, published_at: ago(180), audience: 'cohort', status: 'published', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', archived_at: null, read_at: null, created_at: ago(200), updated_at: ago(180), author: demoAdminUser },
  { id: 7, title: 'Deployment week checklist', body: 'Production URLs, environment variables, and final QA are due before Friday standup. Pair up for the release walkthrough.', pinned: false, published_at: ago(2_000), audience: 'cohort', status: 'published', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', archived_at: null, read_at: ago(1_800), created_at: ago(2_100), updated_at: ago(2_000), author: demoAdminUser },
];

const demoStaffNotifications: AppNotification[] = [
  { id: 301, notification_type: 'submission', title: 'Maya Santos submitted Responsive card grid', body: 'Responsive layouts with Grid · Attempt 2', path: '/admin/submissions/31?cohort_id=4&student_id=18', read_at: null, created_at: ago(4), actor: { id: 18, full_name: 'Maya Santos', email: 'maya@example.com' }, notifiable: { type: 'Submission', id: 31 } },
  { id: 302, notification_type: 'direct_message', title: 'Maya Santos', body: 'Can I send you the repo before office hours?', path: '/messages/dm/31', read_at: null, created_at: ago(16), actor: { id: 18, full_name: 'Maya Santos', email: 'maya@example.com' }, notifiable: { type: 'Message', id: 203 } },
];

const demoStudentNotifications: AppNotification[] = [
  { id: 303, notification_type: 'submission_graded', title: 'Leon graded Semantic page exercise', body: 'HTML and semantic structure · Grade A', path: '/lessons/100', read_at: null, created_at: ago(4), actor: { id: demoAdminUser.id, full_name: demoAdminUser.full_name, email: demoAdminUser.email }, notifiable: { type: 'Submission', id: 8 } },
  { id: 304, notification_type: 'direct_message', title: 'Leon Shimizu', body: 'Your component structure is solid. The redirect loop is probably in the layout guard.', path: '/messages/dm/31', read_at: null, created_at: ago(16), actor: { id: demoAdminUser.id, full_name: demoAdminUser.full_name, email: demoAdminUser.email }, notifiable: { type: 'Message', id: 203 } },
];

export const demoNotifications = demoUser.is_staff ? demoStaffNotifications : demoStudentNotifications;
