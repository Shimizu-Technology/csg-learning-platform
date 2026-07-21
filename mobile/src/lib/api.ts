import type { Announcement, ChannelSummary, DirectConversationSummary, Message, MessageEvent, SessionUser, UserSummary, WorkspaceSummary } from './types';

export type TokenGetter = (options?: { skipCache?: boolean }) => Promise<string | null>;

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class ApiError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) { super(message); }
}

export class CsgApi {
  constructor(private readonly getToken: TokenGetter) {}

  async request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const token = await this.getToken({ skipCache: attempt > 0 });
      const response = await fetch(`${API_URL}${path}`, {
        ...init, signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string; errors?: string[]; code?: string };
        const getRequest = !init.method || init.method === 'GET';
        if (attempt === 0 && (response.status === 401 || (getRequest && RETRYABLE.has(response.status)))) {
          return this.request<T>(path, init, attempt + 1);
        }
        throw new ApiError(payload.error || payload.errors?.join(', ') || `Request failed (${response.status})`, response.status, payload.code);
      }
      if (response.status === 204) return undefined as T;
      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if ((error as Error).name === 'AbortError') throw new ApiError('The request timed out. Check your connection and try again.');
      throw new ApiError('Could not reach Code School. Check your connection and try again.');
    } finally { clearTimeout(timeout); }
  }

  session = () => this.request<{ user: SessionUser }>('/api/v1/sessions', { method: 'POST' });
  workspaces = () => this.request<{ workspaces: WorkspaceSummary[] }>('/api/v1/workspaces');
  channels = () => this.request<{ channels: ChannelSummary[] }>('/api/v1/channels');
  directConversations = () => this.request<{ direct_conversations: DirectConversationSummary[] }>('/api/v1/direct_conversations');
  announcements = () => this.request<{ announcements: Announcement[]; unread_count: number }>('/api/v1/announcements?per_page=50');
  markAnnouncementsRead = () => this.request<{ unread_count: number }>('/api/v1/notifications/mark_all_read?notification_type=announcement', { method: 'PATCH' });
  channel = (id: number) => this.request<{ channel: ChannelSummary; messages: Message[] }>(`/api/v1/channels/${id}?message_limit=100`);
  directConversation = (id: number) => this.request<{ direct_conversation: DirectConversationSummary; messages: Message[] }>(`/api/v1/direct_conversations/${id}?message_limit=100`);
  markRead = (kind: 'channel' | 'dm', id: number) => this.request(kind === 'channel' ? `/api/v1/channels/${id}/read` : `/api/v1/direct_conversations/${id}/read`, { method: 'PATCH' });
  sendMessage = (kind: 'channel' | 'dm', id: number, body: string) => this.request<{ message: Message }>(kind === 'channel' ? `/api/v1/channels/${id}/messages` : `/api/v1/direct_conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ body, send_push: true }) });
  react = (id: number, emoji: string, remove = false) => this.request<{ message: Message }>(`/api/v1/messages/${id}/reactions`, { method: remove ? 'DELETE' : 'POST', body: JSON.stringify({ emoji }) });
  updatePreference = (kind: 'channel' | 'dm', id: number, muted: boolean) => this.request('/api/v1/message_preferences', { method: 'PATCH', body: JSON.stringify({ target_type: kind === 'channel' ? 'Channel' : 'DirectConversation', target_id: id, muted }) });
  availableUsers = (workspaceId: number) => this.request<{ users: UserSummary[] }>(`/api/v1/direct_conversations/available_users?workspace_id=${workspaceId}`);
  createDm = (workspaceId: number, userIds: number[]) => this.request<{ direct_conversation: DirectConversationSummary }>('/api/v1/direct_conversations', { method: 'POST', body: JSON.stringify({ workspace_id: workspaceId, user_ids: userIds }) });
  cableToken = () => this.request<{ token: string; expires_in: number }>('/api/v1/cable_token', { method: 'POST' });
  registerDevice = (token: string, platform: string, deviceId: string | null, appVersion: string | null) => this.request('/api/v1/mobile_push_tokens', { method: 'POST', body: JSON.stringify({ token, platform, device_id: deviceId, app_version: appVersion }) });
  unregisterDevice = (token: string) => this.request(`/api/v1/mobile_push_tokens?token=${encodeURIComponent(token)}`, { method: 'DELETE' });
  search = (query: string) => this.request<{ results: (Message & { context: { type: 'channel' | 'direct_conversation'; id: number; label: string } })[] }>(`/api/v1/messages/search?q=${encodeURIComponent(query)}&limit=30`);
}

export function websocketUrl(token: string) {
  const base = API_URL.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  return `${base}/cable?token=${encodeURIComponent(token)}`;
}

export function websocketOrigin() { return API_URL; }

export type { MessageEvent };
