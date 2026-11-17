import { useState } from 'react'
import { api } from '../../lib/api'
import { SUPPORT_EMAIL } from '../../lib/brand'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { Button } from '../ui/Button'

export function PurchaseReceipt({ purchaseId }: { purchaseId: number }) {
  const [loading, setLoading] = useState(false)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  async function load() {
    setLoading(true); setError('')
    try {
      const result = await api.getCourseReceipt(purchaseId)
      const safe = result.data?.url ? sanitizeUrl(result.data.url) : ''
      if (safe && safe.startsWith('https://') && !result.error) setUrl(safe)
      else setError(result.error || 'Receipt could not load. Try again or request a copy.')
    } catch { setError('Receipt could not load. Try again or request a copy.') }
    finally { setLoading(false) }
  }
  return <div className="mt-1">
    {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="app-link inline-flex min-h-11 items-center">Open receipt</a> : <Button variant="quiet" disabled={loading} onClick={() => void load()}>{loading ? 'Loading receipt…' : 'View receipt'}</Button>}
    {error && <p role="alert" className="text-sm text-danger-ink">{error} <a className="app-link inline-flex min-h-11 items-center" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Receipt for purchase ${purchaseId}`)}`}>Request a copy</a></p>}
  </div>
}
