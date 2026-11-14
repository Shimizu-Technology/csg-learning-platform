import { useRef, useEffect, useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import DOMPurify from 'dompurify'
import { captureProductEvent } from '../../lib/analytics'
import { copyText } from '../../lib/clipboard'
import { LESSON_PLUGINS, WRITTEN_PLUGINS } from '../../lib/writtenMarkdown'
import { CodeBlock } from './CodeBlock'
import { isHafaStarterLink, withLessonReturn } from '../../lib/hafaStarterLinks'
import { DEFAULT_STARTER_LABEL, HafaStarterLink, STARTER_HINTS, STARTER_HINT_CLASS, STARTER_LINK_CLASS, useStarterLinkSameTab, type StarterLinkContext } from './HafaStarterLink'

interface MarkdownRendererProps {
  content: string
  /** Inside a lesson: render Hafa Code starter links as buttons that return to this lesson. */
  starterLinks?: StarterLinkContext
  /**
   * "lesson" (default): CommonMark + GFM, as lessons have always been written.
   * "written": text people type (updates, feedback, help replies, submissions):
   * a single newline is a line break, like the message composer, and raw HTML
   * shows as typed instead of disappearing. See docs/MARKDOWN.md.
   */
  variant?: 'lesson' | 'written'
}

function isHtml(str: string): boolean {
  if (!str) return false
  return /^\s*<(p|div|h[1-6]|ul|ol|li|pre|blockquote|table|br|hr|!DOCTYPE)[\s>]/i.test(str)
}

const COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`
const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`

/**
 * Renders HTML content (from Quill or Trix) with copy buttons on code blocks.
 * Wraps each <pre> in a .code-block-wrapper and injects a copy button via DOM.
 */
function HtmlContentRenderer({ html, starterLinks }: { html: string; starterLinks?: StarterLinkContext }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sameTab = useStarterLinkSameTab() && !starterLinks?.newTab
  const lessonReturnUrl = starterLinks?.lessonReturn.url
  const lessonReturnLabel = starterLinks?.lessonReturn.label
  const starterHint = starterLinks?.hint
  // React 19 rewrites innerHTML whenever this prop object changes. Keep it stable so
  // re-renders keep the copy buttons and link changes applied below, and rebuild it
  // when the starter context changes so the effect decorates pristine HTML again.
  const sanitizedHtml = useMemo(
    () => ({ __html: DOMPurify.sanitize(html) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the starter values reset the DOM on purpose
    [html, lessonReturnUrl, lessonReturnLabel, starterHint, sameTab],
  )

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
      btn.type = 'button'
      btn.className = 'copy-code-btn'
      btn.setAttribute('aria-label', 'Copy code')
      btn.innerHTML = `${COPY_SVG}<span>Copy</span>`
      btn.addEventListener('click', () => {
        const text = pre.textContent || ''
        void copyText(text).then((copied) => {
          if (copied) captureProductEvent('code_block_copied', { surface: 'lesson', language: 'other' })
          btn.dataset.state = copied ? 'copied' : 'failed'
          btn.innerHTML = copied ? `${CHECK_SVG}<span>Copied</span>` : '<span>Copy failed — select the code instead</span>'
          btn.removeAttribute('aria-label')
          setTimeout(() => {
            btn.dataset.state = 'idle'
            btn.setAttribute('aria-label', 'Copy code')
            btn.innerHTML = `${COPY_SVG}<span>Copy</span>`
          }, copied ? 2000 : 4000)
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
      if (starterHint && lessonReturnUrl && isHafaStarterLink(href)) {
        decorateStarterLink(link as HTMLAnchorElement, href, { lessonReturn: { url: lessonReturnUrl, label: lessonReturnLabel }, hint: starterHint }, sameTab)
        return
      }
      if (href?.startsWith('http')) {
        link.setAttribute('target', '_blank')
        link.setAttribute('rel', 'noopener noreferrer')
      }
    })
  }, [sanitizedHtml, lessonReturnUrl, lessonReturnLabel, starterHint, sameTab])

  return (
    <div className="exercise-content">
      <div ref={containerRef} dangerouslySetInnerHTML={sanitizedHtml} />
    </div>
  )
}

let starterHintCount = 0

/**
 * Rich-text (HTML) bodies: the same starter button and hint as HafaStarterLink,
 * applied to freshly sanitized DOM (the container is rebuilt when the context changes).
 */
function decorateStarterLink(link: HTMLAnchorElement, href: string, context: StarterLinkContext, sameTab: boolean) {
  link.setAttribute('href', withLessonReturn(href, context.lessonReturn))
  link.classList.add(...STARTER_LINK_CLASS.split(' '))
  if (sameTab) {
    link.removeAttribute('target')
    link.removeAttribute('rel')
  } else {
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
  }
  const text = link.textContent?.trim()
  if (!text || text === href.trim()) link.textContent = DEFAULT_STARTER_LABEL
  if (!sameTab) {
    const newTab = document.createElement('span')
    newTab.className = 'sr-only'
    newTab.textContent = ' (opens in a new tab)'
    link.append(newTab)
  }
  const hint = document.createElement('span')
  hint.id = `hafa-starter-hint-${++starterHintCount}`
  hint.className = STARTER_HINT_CLASS
  hint.textContent = STARTER_HINTS[context.hint]
  link.after(hint)
  link.setAttribute('aria-describedby', hint.id)
}

type HastNode = { type: string; tagName?: string; value?: string; properties?: { className?: unknown }; children?: HastNode[] }

function hastText(node: HastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value || ''
  return (node.children || []).map(hastText).join('')
}

/**
 * The long-form Markdown renderer: lessons, updates, grading feedback, help
 * replies and text submissions. Fenced code always renders as <CodeBlock>,
 * including single-line and unlabeled fences.
 */
export function MarkdownRenderer({ content, starterLinks, variant = 'lesson' }: MarkdownRendererProps) {
  // Only lessons have legacy HTML bodies (the old rich-text editors). Written text
  // is always Markdown, so "<div>…</div>" typed there shows as typed.
  if (variant === 'lesson' && isHtml(content)) {
    return <HtmlContentRenderer html={content} starterLinks={starterLinks} />
  }

  const components: Components = {
    pre({ node }) {
      const code = (node as HastNode | undefined)?.children?.find((child) => child.type === 'element' && child.tagName === 'code')
      const classes = code?.properties?.className
      const language = (Array.isArray(classes) ? classes.map(String) : [])
        .find((name) => name.startsWith('language-'))?.replace(/^language-/, '') || ''
      return <CodeBlock code={hastText(code).replace(/\n$/, '')} language={language} />
    },
    code({ children, node: _node, ...props }) {
      void _node
      return <code className="inline-code" {...props}>{children}</code>
    },
    table({ children, node: _node, ...props }) {
      void _node
      return <div className="table-scroll"><table {...props}>{children}</table></div>
    },
    a({ href, children, node: _node, ...props }) {
      void _node
      if (starterLinks && isHafaStarterLink(href)) {
        return <HafaStarterLink href={href} context={starterLinks}>{children}</HafaStarterLink>
      }
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
  }

  if (variant === 'written') {
    // Written text always sits under a page or card title, so its headings start one level down.
    for (const level of [1, 2, 3, 4, 5, 6] as const) {
      const Tag = `h${Math.min(level + 1, 6)}` as 'h2'
      components[`h${level}`] = ({ children, node: _node, ...props }) => {
        void _node
        return <Tag {...props}>{children}</Tag>
      }
    }
  }

  return (
    <div className={variant === 'written' ? 'exercise-content written-content' : 'exercise-content'}>
      <ReactMarkdown
        remarkPlugins={variant === 'written' ? WRITTEN_PLUGINS : LESSON_PLUGINS}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

/** Text people write (updates, feedback, help replies, submissions), through the one renderer. */
export function MarkdownText({ content }: { content: string }) {
  return <MarkdownRenderer content={content} variant="written" />
}
