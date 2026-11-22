import { useId, useState } from 'react'
import { Copy, Share2 } from 'lucide-react'
import { CERTIFICATE_TITLE, certificatePath } from '../../lib/certificates'
import { Button } from '../ui/Button'

export function CertificateLinkActions({ code, share = false }: { code: string; share?: boolean }) {
  const inputId = useId()
  const [copied, setCopied] = useState(false)
  const [showLink, setShowLink] = useState(false)
  const url = new URL(certificatePath(code), window.location.origin).href

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setShowLink(false)
    } catch {
      setShowLink(true)
    }
  }

  async function shareLink() {
    if (navigator.share) {
      try {
        await navigator.share({ title: CERTIFICATE_TITLE, url })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    await copy()
  }

  return <>
    <Button variant="secondary" shape={share ? 'brand' : 'default'} onClick={() => void copy()}>
      <Copy className="size-4" aria-hidden="true" /> Copy verify link
    </Button>
    {share && <Button variant="secondary" shape="brand" onClick={() => void shareLink()}>
      <Share2 className="size-4" aria-hidden="true" /> Share
    </Button>}
    {copied && <span role="status" className="self-center text-sm text-success-ink">Link copied</span>}
    {showLink && <div className="w-full text-sm">
      <label htmlFor={inputId} className="font-semibold">Verification link</label>
      <input id={inputId} readOnly className="app-control mt-1 w-full" value={url} onFocus={(event) => event.target.select()} />
    </div>}
  </>
}
