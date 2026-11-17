import policy from '../../../api/config/web_handoff_policy.json';
export function canHandoff(path: unknown, user: { is_staff?: boolean; is_admin?: boolean } | null): path is string {
  if (!user || typeof path !== 'string') return false;
  const base = path.split(/[?#]/, 1)[0];
  if (!(new RegExp(`^(?:${policy.path_pattern})$`).test(base) || new RegExp(`^(?:${policy.recording_pattern})$`).test(path))) return false;
  if (policy.admin_only_paths.includes(base) && !user.is_admin) return false;
  if (base.startsWith('/admin') && !user.is_staff) return false;
  if (base !== '/admin/meetings') return true;
  if (path.includes('#') || path.split('?').length > 2) return false;
  if (!path.includes('?')) return true;
  const pairs = [...new URLSearchParams(path.split('?')[1])];
  return pairs.length > 0 && new Set(pairs.map(([key]) => key)).size === pairs.length && pairs.every(([key, value]) => policy.meeting_query_keys.includes(key) && /^[1-9]\d*$/.test(value));
}
