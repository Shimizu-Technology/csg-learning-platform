import type { MessageEvent } from './types';
import { CsgApi, websocketOrigin, websocketUrl } from './api';

type Status = 'connecting' | 'connected' | 'offline';

interface CableEnvelope { type?: string; identifier?: string; message?: MessageEvent }
type NativeWebSocketConstructor = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WebSocket;

export function parseCableEnvelope(raw: string): MessageEvent | null {
  try {
    const parsed = JSON.parse(raw) as CableEnvelope;
    return parsed.message?.event ? parsed.message : null;
  } catch { return null; }
}

export function subscribeToUserMessages(
  api: CsgApi,
  onEvent: (event: MessageEvent) => void,
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
      onStatus('offline');
      attempts += 1;
      reconnectTimer = setTimeout(connect, Math.min(1_000 * 2 ** attempts, 30_000));
    }
  };
  void connect();

  return () => {
    cancelled = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ command: 'unsubscribe', identifier }));
    socket?.close();
  };
}

export function subscribeToMessages(
  api: CsgApi,
  kind: 'channel' | 'dm',
  id: number,
  onEvent: (event: MessageEvent) => void,
  onStatus: (status: Status) => void,
) {
  return subscribeToUserMessages(api, (event) => {
    const matches = kind === 'channel' ? event.channel_id === id : event.direct_conversation_id === id;
    if (matches) onEvent(event);
  }, onStatus);
}
