export type ConversationKind = 'channel' | 'dm';

export interface UserSummary {
  id: number;
  full_name: string;
  email: string;
  role: string;
  avatar_url: string | null;
  is_admin: boolean;
  is_staff: boolean;
}

export interface SessionUser extends UserSummary {
  clerk_id: string;
  first_name: string;
  last_name: string;
  github_username: string | null;
}

export interface WorkspaceSummary {
  id: number;
  name: string;
  slug: string;
  workspace_type: 'cohort' | 'community';
  status: 'active' | 'archived';
  cohort_id: number | null;
  cohort_name: string | null;
  description: string | null;
  member_count: number;
  can_manage: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember extends UserSummary {
  membership_role: string;
}

export interface WorkspaceDetail extends WorkspaceSummary {
  members: WorkspaceMember[];
}

export interface LatestMessage {
  id: number;
  body: string;
  created_at: string;
  author_name: string;
}

export interface ChannelSummary {
  id: number;
  workspace_id: number;
  workspace_name: string;
  workspace_type: 'cohort' | 'community';
  cohort_id: number | null;
  cohort_name: string | null;
  name: string;
  description: string | null;
  visibility: 'cohort' | 'staff_only';
  status: 'active' | 'archived';
  position: number;
  muted: boolean;
  unread_count: number;
  last_read_at: string | null;
  latest_message: LatestMessage | null;
  created_at: string;
  updated_at: string;
}

export interface DirectConversationSummary {
  id: number;
  workspace_id: number;
  workspace_name: string;
  workspace_type: 'cohort' | 'community';
  cohort_id: number | null;
  cohort_name: string | null;
  title: string;
  status: 'active' | 'archived';
  muted: boolean;
  unread_count: number;
  last_read_at: string | null;
  latest_message: LatestMessage | null;
  users: UserSummary[];
  created_at: string;
  updated_at: string;
}

export interface MessageReaction {
  emoji: string;
  count: number;
  reacted: boolean;
  users: Pick<UserSummary, 'id' | 'full_name' | 'avatar_url'>[];
}

export interface Message {
  id: number;
  channel_id: number | null;
  direct_conversation_id: number | null;
  parent_message_id: number | null;
  body: string;
  mention_user_ids: number[];
  edited_at: string | null;
  deleted_at: string | null;
  pinned_at: string | null;
  pinned_by_id?: number | null;
  created_at: string;
  updated_at: string;
  mine: boolean;
  reactions: MessageReaction[];
  attachments: { id: number; filename: string; content_type: string; byte_size: number; image: boolean; url?: string }[];
  read_receipts?: { count: number; users: Pick<UserSummary, 'id' | 'full_name' | 'avatar_url'>[] };
  client_status?: 'sending' | 'failed';
  client_error?: string;
  client_uploads?: UploadAttachmentInput[];
  reply_count?: number;
  author: Pick<UserSummary, 'id' | 'full_name' | 'email' | 'role' | 'avatar_url'>;
}

export interface MessageWindowMeta {
  oldest_message_id: number | null;
  newest_message_id: number | null;
  has_older: boolean;
  has_newer: boolean;
}

export interface ConversationPayload {
  messages: Message[];
  pinned_messages: Message[];
  meta: MessageWindowMeta;
}

export interface UploadAttachmentInput {
  s3_key: string;
  filename: string;
  content_type: string;
  byte_size: number;
}

export interface PendingAttachment {
  local_id: string;
  uri: string;
  filename: string;
  content_type: string;
  byte_size: number;
  image: boolean;
  status: 'queued' | 'uploading' | 'uploaded' | 'failed';
  progress: number;
  error?: string;
  uploaded?: UploadAttachmentInput;
}

export interface Announcement {
  id: number;
  title: string;
  body: string;
  pinned: boolean;
  published_at: string | null;
  audience: 'cohort' | 'global' | 'staff';
  status: 'draft' | 'published' | 'archived';
  cohort_name: string | null;
  cohort_id: number | null;
  read_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  author?: Pick<UserSummary, 'id' | 'full_name' | 'email'>;
}

export interface PaginationMeta {
  page: number;
  per_page: number;
  total_count: number;
  total_pages: number;
  has_next_page: boolean;
  has_prev_page: boolean;
}

export interface AppNotification {
  id: number;
  notification_type: 'announcement' | 'message' | 'mention' | 'direct_message' | string;
  title: string;
  body: string;
  path: string;
  read_at: string | null;
  created_at: string;
  actor: Pick<UserSummary, 'id' | 'full_name' | 'email'> | null;
  notifiable: { type: string; id: number };
}

export interface PushConfig {
  configured?: boolean;
  public_key?: string | null;
  missing?: string[];
  notifications_enabled: boolean;
  active_subscription_count: number;
}

export interface MessageEvent {
  event: 'created' | 'updated' | 'deleted';
  channel_id: number | null;
  direct_conversation_id: number | null;
  message: Message;
  channel?: ChannelSummary | null;
  direct_conversation?: DirectConversationSummary | null;
}
