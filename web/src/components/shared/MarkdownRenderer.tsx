import { useState, useCallback, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import DOMPurify from 'dompurify'
import { Copy, Check } from 'lucide-react'

interface MarkdownRendererProps {
  content: string
}

function isHtml(str: string): boolean {
  if (!str) return false
  return /^\s*<(p|div|h[1-6]|ul|ol|li|pre|blockquote|table|br|hr|!DOCTYPE)[\s>]/i.test(str)
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className="copy-code-btn"
      title="Copy code"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5" />
          <span>Copied</span>
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          <span>Copy Code</span>
        </>
      )}
    </button>
  )
}

const COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`
const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`

/**
 * Renders HTML content (from Quill or Trix) with copy buttons on code blocks.
 * Wraps each <pre> in a .code-block-wrapper and injects a copy button via DOM.
 */
function HtmlContentRenderer({ html }: { html: string }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const pres = el.querySelectorAll('pre')
    pres.forEach((pre) => {
      if (pre.parentElement?.classList.contains('code-block-wrapper')) return

      const wrapper = document.createElement('div')
      wrapper.className = 'code-block-wrapper'
      pre.parentNode?.insertBefore(wrapper, pre)
      wrapper.appendChild(pre)

      const btn = document.createElement('button')
      btn.className = 'copy-code-btn'
      btn.title = 'Copy code'
      btn.innerHTML = `${COPY_SVG}<span>Copy Code</span>`
      btn.addEventListener('click', () => {
        const text = pre.textContent || ''
        navigator.clipboard.writeText(text).then(() => {
          btn.innerHTML = `${CHECK_SVG}<span>Copied</span>`
          setTimeout(() => {
            btn.innerHTML = `${COPY_SVG}<span>Copy Code</span>`
          }, 2000)
        })
      })
      wrapper.insertBefore(btn, pre)
    })

    const inlineCodes = el.querySelectorAll('code')
    inlineCodes.forEach((code) => {
      if (code.closest('pre')) return
      code.classList.add('inline-code')
    })

    const links = el.querySelectorAll('a[href]')
    links.forEach((link) => {
      const href = link.getAttribute('href')
      if (href?.startsWith('http')) {
        link.setAttribute('target', '_blank')
        link.setAttribute('rel', 'noopener noreferrer')
      }
    })
  }, [html])

  return (
    <div className="exercise-content">
      <div ref={containerRef} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
    </div>
  )
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  if (isHtml(content)) {
    return <HtmlContentRenderer html={content} />
  }

  return (
    <div className="exercise-content">
      <ReactMarkdown
        components={{
          pre({ children }) {
            return <>{children}</>
          },
          code({ className, children, ...props }) {
            const text = String(children).replace(/\n$/, '')
            const isBlock = !className && text.includes('\n')

            if (isBlock || className) {
              return (
                <div className="code-block-wrapper">
                  <CopyButton text={text} />
                  <pre>
                    <code {...props}>{children}</code>
                  </pre>
                </div>
              )
            }
            return <code className="inline-code" {...props}>{children}</code>
          },
          a({ href, children, ...props }) {
            return (
              <a
                href={href}
                target={href?.startsWith('http') ? '_blank' : undefined}
                rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
                {...props}
              >
                {children}
              </a>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
