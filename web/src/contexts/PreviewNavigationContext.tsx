import { createContext, useContext } from 'react'
import { Link as RouterLink, type LinkProps } from 'react-router-dom'

export const PreviewNavigationContext = createContext<((path: string) => string) | null>(null)
export function PreviewLink({ to, ...props }: LinkProps) {
  const previewPath = useContext(PreviewNavigationContext)
  return <RouterLink {...props} to={previewPath && typeof to === 'string' ? previewPath(to) : to} />
}
