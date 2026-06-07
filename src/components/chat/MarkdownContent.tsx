import { type ReactNode, isValidElement } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'

interface MarkdownContentProps {
  content: string
}

const BOX_CHARS = /[│┌┐└┘├┤┬┴┼]/

function extractText(children: ReactNode): string {
  if (children == null) return ''
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(extractText).join('')
  if (isValidElement(children)) {
    const props = children.props as { children?: ReactNode }
    return extractText(props.children)
  }
  return String(children)
}

/** 从 HAST 节点读取代码块原文；无语言标记的 ``` 围栏也须按块级渲染 */
function extractCodeText(node: unknown, children: ReactNode): string {
  const el = node as { children?: Array<{ value?: string }> } | undefined
  const value = el?.children?.[0]?.value
  if (typeof value === 'string') return value
  return extractText(children)
}

function isBlockCode(className: string | undefined, text: string): boolean {
  return text.includes('\n') || Boolean(className?.startsWith('language-'))
}

function looksLikeDiagram(text: string): boolean {
  return BOX_CHARS.test(text) || (text.match(/\|/g)?.length ?? 0) >= 8
}

function BlockPre({ text, variant }: { text: string; variant: 'diagram' | 'code' }) {
  const isDiagram = variant === 'diagram'
  return (
    <div className="not-prose my-2 w-full max-w-full min-w-0 overflow-x-auto">
      <pre
        className={
          isDiagram
            ? 'text-[10px] font-mono text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-3 whitespace-pre leading-relaxed inline-block min-w-full'
            : 'bg-gray-900 text-gray-100 rounded-lg p-3 text-xs whitespace-pre inline-block min-w-full'
        }
      >
        {text}
      </pre>
    </div>
  )
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="px-2 min-w-0 w-full max-w-full text-gray-800">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-lg font-bold text-gray-900 mt-4 mb-2">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-bold text-gray-900 mt-3 mb-2">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-bold text-gray-900 mt-3 mb-1.5">{children}</h3>
          ),
          p: ({ children }) => (
            <p className="text-sm leading-relaxed mb-2 last:mb-0">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-bold text-gray-900">{children}</strong>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-inside text-sm space-y-1 mb-2">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside text-sm space-y-1 mb-2">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-sm text-gray-700">{children}</li>
          ),
          code: ({ className, children, node }) => {
            const text = extractCodeText(node, children)
            if (!isBlockCode(className, text)) {
              return (
                <code className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-xs font-mono">
                  {children}
                </code>
              )
            }
            const variant = className?.includes('language-diagram') || looksLikeDiagram(text) ? 'diagram' : 'code'
            return <BlockPre text={text} variant={variant} />
          },
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <div className="not-prose overflow-x-auto my-2 w-full max-w-full min-w-0">
              <table className="w-full text-xs border border-gray-400">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead>{children}</thead>,
          th: ({ children }) => (
            <th className="px-3 py-2 text-left font-semibold text-gray-700 border border-gray-400 bg-transparent whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-1.5 text-gray-700 border border-gray-400 bg-transparent whitespace-nowrap">
              {children}
            </td>
          ),
          hr: () => <hr className="my-3 border-gray-200" />,
          blockquote: ({ children }) => (
            <blockquote className="border-l-3 border-green-400 pl-3 my-2 text-sm text-gray-600 italic">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} className="text-green-700 underline hover:text-green-800" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
