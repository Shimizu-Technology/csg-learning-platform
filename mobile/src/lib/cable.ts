import type { MessageEvent, MessageTypingEvent, RealtimeMessageEvent } from './types';
import { CsgApi, websocketOrigin, websocketUrl } from './api';

type Status = 'connecting' | 'connected' | 'offline';

interface CableEnvelope { type?: string; identifier?: string; message?: RealtimeMessageEvent }
export type CableSubscription = (() => void) & {
  perform: (action: string, data?: Record<string, unknown>) => boolean;
};
type NativeWebSocketConstructor = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WebSocket;

export function parseCableEnvelope(raw: string): RealtimeMessageEvent | null {
  try {
    const parsed = JSON.parse(raw) as CableEnvelope;
    const event = parsed.message;
    if (!event) return null;
    if (event.event === 'typing') {
      return (typeof event.channel_id === 'number' || event.channel_id === null)
        && (typeof event.direct_conversation_id === 'number' || event.direct_conversation_id === null)
        && (typeof event.thread_root_id === 'number' || event.thread_root_id === null)
        && typeof event.active === 'boolean'
        && typeof event.user?.id === 'number'
        && typeof event.user.full_name === 'string'
        ? event
        : null;
    }
    return ['created', 'updated', 'deleted'].includes(event.event) && event.message ? event : null;
  } catch { return null; }
}

export function subscribeToUserMessages(
  api: CsgApi,
  onEvent: (event: RealtimeMessageEvent) => void,
  onStatus: (status: Status) => void = () => undefined,
) {
  let socket: WebSocket | null = null;
  let cancelled = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  const identifier = JSON.stringify({ channel: 'UserMessagesChannel' });

  const connect = async () => {
    if (cancelled) return;
    onStatus('connecting');
    try {
      const { token } = await api.cableToken();
      if (cancelled) return;
      const NativeWebSocket = WebSocket as unknown as NativeWebSocketConstructor;
      socket = new NativeWebSocket(websocketUrl(token), undefined, { headers: { Origin: websocketOrigin() } });
      socket.onopen = () => socket?.send(JSON.stringify({ command: 'subscribe', identifier }));
      socket.onmessage = ({ data }) => {
        let envelope: CableEnvelope;
        try { envelope = JSON.parse(String(data)) as CableEnvelope; } catch { return; }
        if (envelope.type === 'confirm_subscription') { attempts = 0; onStatus('connected'); return; }
        const event = parseCableEnvelope(String(data));
        if (event) onEvent(event);
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (cancelled) return;
        onStatus('offline');
        attempts += 1;
        reconnectTimer = setTimeout(connect, Math.min(1_000 * 2 ** attempts, 30_000));
      };
    } catch {
      if (cancelled) return;
      onStatus('offline');
      attempts += 1;
      reconnectTimer = setTimeout(connect, Math.min(1_000 * 2 ** attempts, 30_000));
    }
  };
  void connect();

  const subscription = (() => {
    cancelled = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ command: 'unsubscribe', identifier }));
    socket?.close();
  }) as CableSubscription;
  subscription.perform = (action, data = {}) => {
    if (cancelled || socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ command: 'message', identifier, data: JSON.stringify({ action, ...data }) }));
    return true;
  };
  return subscription;
}

export function subscribeToMessages(
  api: CsgApi,
  kind: 'channel' | 'dm',
  id: number,
  onEvent: (event: MessageEvent) => void,
  onStatus: (status: Status) => void,
  onTyping: (event: MessageTypingEvent) => void = () => undefined,
) {
  return subscribeToUserMessages(api, (event) => {
    const matches = kind === 'channel' ? event.channel_id === id : event.direct_conversation_id === id;
    if (!matches) return;
    if (event.event === 'typing') onTyping(event);
    else onEvent(event);
  }, onStatus);
}
