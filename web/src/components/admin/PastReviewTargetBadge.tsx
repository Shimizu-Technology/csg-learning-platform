import { Clock } from 'lucide-react'
import { Badge } from '../ui/Badge'

export function PastReviewTargetBadge() {
  return <Badge tone="danger" icon={<Clock className="h-3.5 w-3.5" aria-hidden="true" />}>Past review target</Badge>
}
