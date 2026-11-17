import { createContext, useContext, useState, type ReactNode } from 'react'
import { createMemoryRouter, Outlet, RouterProvider, type RouteObject } from 'react-router-dom'
import { LeaveGuardProvider } from '../lib/useLeaveGuard'

const ChildrenContext = createContext<ReactNode>(null)
function CurrentChildren() { return useContext(ChildrenContext) }
type InitialEntries = NonNullable<NonNullable<Parameters<typeof createMemoryRouter>[1]>['initialEntries']>

/** `initialEntries` may carry router state, e.g. `{ pathname, state: { returnTo, returnLabel } }`. */
export function TestRouter({ children, initialEntries = ['/'] }: { children: ReactNode; initialEntries?: InitialEntries }) {
  const [router] = useState(() => createMemoryRouter([{ path: '*', element: <LeaveGuardProvider><CurrentChildren /></LeaveGuardProvider> }], { initialEntries }))
  return <ChildrenContext.Provider value={children}><RouterProvider router={router} /></ChildrenContext.Provider>
}

/** Routes under the app's leave guard, as App mounts them, for tests that build their own memory router. */
export function withLeaveGuard(routes: RouteObject[]): RouteObject[] {
  return [{ element: <LeaveGuardProvider><Outlet /></LeaveGuardProvider>, children: routes }]
}
