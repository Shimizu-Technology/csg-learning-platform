import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown, { type Components } from 'react-markdown'
import DOMPurify from 'dompurify'
import { LESSON_PLUGINS, WRITTEN_PLUGINS } from '../../lib/writtenMarkdown'
import { CodeBlock } from './CodeBlock'
import { isHafaStarterLink, withLessonReturn } from '../../lib/hafaStarterLinks'
import { DEFAULT_STARTER_LABEL, HafaStarterLink, STARTER_HINTS, STARTER_HINT_CLASS, STARTER_LINK_CLASS, useStarterLinkSameTab, type StarterLinkContext } from './HafaStarterLink'
import { isLessonHtml } from '../../lib/lessonHtml'

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


const CODE_SLOT = 'data-code-block-slot'

/** "language-js" / "lang-js" on the <pre> or its <code>, as TipTap and older editors write it. */
function preLanguage(pre: Element) {
  const classes = `${pre.className} ${pre.querySelector('code')?.className || ''}`
  return classes.match(/(?:^|\s)lang(?:uage)?-([\w+#-]+)/)?.[1] || ''
}

/**
 * Sanitize legacy HTML, then swap each <pre> for an empty slot that a
 * <CodeBlock> is portalled into, so old rich-text lessons get the same code
 * block as Markdown ones (spec §8). Slots are made after sanitizing, and any
 * slot attribute already in the HTML is removed first.
 */
export function prepareLessonHtml(html: string) {
  const clean = DOMPurify.sanitize(html)
  const template = document.createElement('template')
  template.innerHTML = clean
  template.content.querySelectorAll(`[${CODE_SLOT}]`).forEach((element) => element.removeAttribute(CODE_SLOT))
  const blocks: Array<{ code: string; language: string }> = []
  template.content.querySelectorAll('pre').forEach((pre) => {
    const slot = document.createElement('div')
    slot.setAttribute(CODE_SLOT, String(blocks.length))
    blocks.push({ code: (pre.textContent || '').replace(/\n$/, ''), language: preLanguage(pre) })
    pre.replaceWith(slot)
  })
  return { html: template.innerHTML, blocks }
}

/**
 * Renders HTML content (from Quill or Trix) with the shared <CodeBlock> for
 * every <pre>.
 */
function HtmlContentRenderer({ html, starterLinks }: { html: string; starterLinks?: StarterLinkContext }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sameTab = useStarterLinkSameTab() && !starterLinks?.newTab
  const lessonReturnUrl = starterLinks?.lessonReturn.url
  const lessonReturnLabel = starterLinks?.lessonReturn.label
  const starterHint = starterLinks?.hint
  const prepared = useMemo(() => prepareLessonHtml(html), [html])
  // React 19 rewrites innerHTML whenever this prop object changes. Keep it stable so
  // re-renders keep the code blocks and link changes applied below, and rebuild it
  // when the starter context changes so the effect decorates pristine HTML again.
  const sanitizedHtml = useMemo(
    () => ({ __html: prepared.html }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the starter values reset the DOM on purpose
    [prepared, lessonReturnUrl, lessonReturnLabel, starterHint, sameTab],
  )
  const [slots, setSlots] = useState<Array<{ element: Element; index: number }>>([])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    // Idempotent (StrictMode runs this twice): slots are found, never created, here.
    setSlots(Array.from(el.querySelectorAll(`[${CODE_SLOT}]`), (element) => ({ element, index: Number(element.getAttribute(CODE_SLOT)) })))

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
      {slots.map(({ element, index }) => {
        const block = prepared.blocks[index]
        return block ? createPortal(<CodeBlock code={block.code} language={block.language} />, element, `code-${index}`) : null
      })}
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
  if (variant === 'lesson' && isLessonHtml(content)) {
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
