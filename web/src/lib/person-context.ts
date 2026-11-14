// Build labels from the full list before filtering so suffixes stay stable during search.
type PersonIdentity = { id: number; full_name: string; role?: string; cohort_name?: string | null };
export function personContext(user: PersonIdentity, users: readonly PersonIdentity[], workspace = ''): string {
  const context = [user.role, user.cohort_name || workspace].filter(Boolean).join(' · ');
  const duplicates = users.filter((other) => other.full_name.trim().toLowerCase() === user.full_name.trim().toLowerCase());
  const peers = duplicates.filter((other) => (other.cohort_name || workspace) === (user.cohort_name || workspace)).sort((a, b) => a.id - b.id);
  return duplicates.length > 1 && peers.length > 1 ? `${context} · ${peers.findIndex((other) => other.id === user.id) + 1}` : context;
}

export function matchingPeople(users: readonly PersonIdentity[], query: string, workspace = '', limit = 8): PersonIdentity[] {
  const normalized = query.trim().toLowerCase();
  return users.filter((user) => `${user.full_name} ${personContext(user, users, workspace)}`.toLowerCase().includes(normalized)).slice(0, limit);
}
