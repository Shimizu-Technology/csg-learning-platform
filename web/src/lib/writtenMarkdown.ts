import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified, type PluggableList } from 'unified'

type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[] }

const FLOW_CONTAINERS = new Set(['root', 'blockquote', 'listItem'])

/**
 * Raw HTML in written text is shown as typed ("use a <div>"), never dropped or
 * rendered. An HTML block becomes a paragraph of text. Runs before remark-breaks
 * so its line breaks are kept.
 */
export function remarkHtmlAsText() {
  const visit = (node: MarkdownNode) => {
    node.children = node.children?.map((child) => {
      if (child.type !== 'html') return child
      const text = { type: 'text', value: child.value }
      return FLOW_CONTAINERS.has(node.type) ? { type: 'paragraph', children: [text] } : text
    })
    node.children?.forEach(visit)
  }
  return (tree: MarkdownNode) => visit(tree)
}

// GFM tables, task lists, autolinks and ~~strike~~. One tilde stays literal ("~375px and ~400px").
export const LESSON_PLUGINS: PluggableList = [[remarkGfm, { singleTilde: false }]]
/** Updates, grading feedback, help replies and text submissions (`MarkdownText`). */
export const WRITTEN_PLUGINS: PluggableList = [[remarkGfm, { singleTilde: false }], remarkHtmlAsText, remarkBreaks]

const writtenProcessor = unified().use(remarkParse).use(WRITTEN_PLUGINS).freeze()

type TreeNode = { type: string; position?: unknown; children?: TreeNode[]; [key: string]: unknown }

function withoutPositions(node: TreeNode): unknown {
  const { position: _position, children, ...rest } = node
  void _position
  return children ? { ...rest, children: children.map(withoutPositions) } : rest
}

/**
 * The tree written-text readers see (the same remark pipeline `MarkdownText`
 * renders), without source positions, as a string for comparing two Markdown
 * strings. Spelling that renders the same (`*` or `-` bullets, `*` or `_`
 * emphasis, an entity or its character) gives the same tree.
 */
export function writtenMarkdownStructure(markdown: string): string {
  const tree = writtenProcessor.runSync(writtenProcessor.parse(markdown)) as unknown as TreeNode
  return JSON.stringify(withoutPositions(tree))
}
