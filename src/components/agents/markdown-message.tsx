import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeSlug from 'rehype-slug'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import Markdown from 'react-markdown'
import 'katex/dist/katex.min.css'

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'abbr',
    'details',
    'figcaption',
    'figure',
    'kbd',
    'mark',
    'summary',
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      'href',
      'title',
      'target',
      'rel',
    ],
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ['className', /^language-./],
    ],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ['className', 'math', 'math-display'],
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ['className', 'math', 'math-inline'],
    ],
  },
}

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown-message">
      <Markdown
        remarkPlugins={[
          [remarkGfm, { singleTilde: false }],
          remarkBreaks,
          remarkMath,
        ]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, sanitizeSchema],
          rehypeKatex,
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
          rehypeSlug,
          [
            rehypeAutolinkHeadings,
            {
              behavior: 'append',
              properties: {
                className: ['markdown-heading-anchor'],
                ariaLabel: '标题链接',
              },
            },
          ],
        ]}
        components={{
          a({ node: _node, href, children, ...props }) {
            const external = href?.startsWith('http')
            return (
              <a
                {...props}
                href={href}
                {...(external
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
              >
                {children}
              </a>
            )
          },
          img({ node: _node, alt = '', ...props }) {
            return <img {...props} alt={alt} loading="lazy" />
          },
          table({ node: _node, children, ...props }) {
            return (
              <div className="markdown-table-wrap">
                <table {...props}>{children}</table>
              </div>
            )
          },
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}
