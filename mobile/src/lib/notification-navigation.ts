/** A single reset preserves a tab home on warm and cold notification entry. */
export function notificationStack(path: string, current?: NavigationState): NavigationState & { index: number } {
  const [pathname, query] = path.split('?');
  const params = Object.fromEntries(new URLSearchParams(query));
  const parts = pathname.split('/').filter(Boolean);
  const tab = ['/', '/learn', '/updates'].includes(pathname) ? (parts[0] || 'index') : null;
  const home = pathname.startsWith('/conversation/') ? 'messages' : 'index';
  // Preserve the mounted tab route identity. Remounting tabs during a reset can
  // emit a focus event that pops the newly opened detail on SDK 57.
  const tabs = (name: string, params?: object) => {
    const previous = current?.routes.find(route => route.name === '(tabs)');
    const state = previous?.state;
    const index = state?.routes.findIndex(route => route.name === name) ?? -1;
    return index >= 0 && state ? { ...previous!, state: { ...state, index, routes: state.routes.map((route, i) => i === index ? { ...route, params } : route) } }
      : { name: '(tabs)', state: { index: 0, routes: [{ name, ...(params ? { params } : {}) }] } };
  };
  if (tab) return { index: 0, routes: [tabs(tab, params)] };
  let name = pathname.slice(1);
  if (parts[0] === 'conversation') { name = 'conversation/[kind]/[id]'; params.kind = parts[1]; params.id = parts[2]; }
  else if (parts.length > 1 && !['grading', 'support'].includes(parts.at(-1)!)) {
    params.id = parts.at(-1)!;
    name = [...parts.slice(0, -1), '[id]'].join('/');
  }
  return { index: 1, routes: [tabs(home), { name, params }] };
}

export interface NavigationState {
  key?: string;
  index?: number;
  routeNames?: readonly string[];
  routes: readonly { key?: string; name: string; params?: object; state?: NavigationState }[];
}
export function applicationNavigator(state: NavigationState | undefined): NavigationState | undefined {
  if (state?.routeNames?.includes('(app)')) return state;
  for (const route of state?.routes ?? []) {
    const found = applicationNavigator(route.state);
    if (found) return found;
  }
}
export function notificationArrived(state: NavigationState | undefined, path: string): boolean {
  const app = applicationNavigator(state)?.routes.find(route => route.name === '(app)')?.state;
  const expected = notificationStack(path);
  if (!app || app.routes[0]?.name !== '(tabs)') return false;
  let actual: NavigationState['routes'][number] | undefined = app.routes[app.index ?? 0];
  let target = expected.routes[expected.index];
  if (target.name === '(tabs)') {
    actual = actual?.state?.routes[actual.state.index ?? 0];
    target = target.state!.routes[0];
  }
  return actual?.name === target.name && Object.entries(target.params ?? {}).every(([key, value]) => (actual.params as Record<string, unknown> | undefined)?.[key] === value);
}
