import ReactMarkdown from 'react-markdown'

interface MarkdownRendererProps {
  content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="prose prose-slate max-w-none prose-headings:text-slate-900 prose-p:text-slate-700 prose-li:text-slate-700 prose-code:bg-slate-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:font-semibold prose-code:text-slate-800 prose-code:before:content-none prose-code:after:content-none prose-a:text-primary-600 prose-a:no-underline hover:prose-a:underline">
      <ReactMarkdown
        components={{
          pre({ children }) {
            return <>{children}</>
          },
          code({ className, children, ...props }) {
            const isBlock = !className && String(children).includes('\n')
            if (isBlock || className) {
              return (
                <pre className="rounded-lg border border-slate-200 bg-slate-50 p-4 overflow-x-auto text-sm leading-relaxed">
                  <code className="text-slate-800 font-mono whitespace-pre" {...props}>
                    {children}
                  </code>
                </pre>
              )
            }
            return <code className={className} {...props}>{children}</code>
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
