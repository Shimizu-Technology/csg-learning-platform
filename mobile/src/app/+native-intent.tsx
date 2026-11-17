import { queueIncomingLink } from '@/lib/incoming-link';
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  // Clerk consumes this callback itself; it must not replace a held content link.
  if (path === '/' || /^(?:(?:csgconnect|csglearn|exp\+csg-connect):\/{2,3}|\/)oauth-callback(?:[?#]|$)/.test(path)) return '/';
  queueIncomingLink(path);
  return '/';
}
