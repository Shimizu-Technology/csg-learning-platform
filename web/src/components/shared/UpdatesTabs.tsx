import { useLocation } from 'react-router-dom'
import { LinkButton } from '../ui/Button'

export function UpdatesTabs({ selected }: { selected: 'announcements' | 'inbox' }) {
  const location = useLocation()
  const inbox = new URLSearchParams(location.search)
  inbox.set('tab', 'inbox')
  const feed = new URLSearchParams(location.search)
  feed.delete('tab')
  return <nav aria-label="Updates sections" className="flex gap-2">
    <LinkButton to={`/announcements?${feed}`} variant={selected === 'announcements' ? 'primary' : 'secondary'} aria-current={selected === 'announcements' ? 'page' : undefined}>Announcements</LinkButton>
    <LinkButton to={`/announcements?${inbox}`} variant={selected === 'inbox' ? 'primary' : 'secondary'} aria-current={selected === 'inbox' ? 'page' : undefined}>Inbox</LinkButton>
  </nav>
}
