import { createContext, useContext, useState, type ReactNode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'

const ChildrenContext = createContext<ReactNode>(null)
function CurrentChildren() { return useContext(ChildrenContext) }
export function TestRouter({ children, initialEntries = ['/'] }: { children: ReactNode; initialEntries?: string[] }) {
  const [router] = useState(() => createMemoryRouter([{ path: '*', element: <CurrentChildren /> }], { initialEntries }))
  return <ChildrenContext.Provider value={children}><RouterProvider router={router} /></ChildrenContext.Provider>
}
