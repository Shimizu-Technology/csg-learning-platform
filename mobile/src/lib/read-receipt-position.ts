import type { Message } from './types';

/** Display each known reader once, beside the latest outgoing message they reached. */
export function latestReaderPositions(messages: Message[]): Map<number, string> {
  const labels = new Map<number, string>();
  const placedReaders = new Set<number>();
  for (const message of [...messages].reverse()) {
    if (!message.mine || message.parent_message_id || !message.read_receipts) continue;
    const readers = message.read_receipts.users.filter((user) => !placedReaders.has(user.id));
    if (!readers.length) continue;
    readers.forEach((user) => placedReaders.add(user.id));
    labels.set(message.id, readers.length === 1 ? `Read by ${readers[0].full_name}` : `Read by ${readers.length}`);
  }
  return labels;
}
