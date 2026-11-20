/**
 * Recipe-card text keeps <b>ingredient</b> markup and entities like &amp;. Render it safely: <b> becomes
 * <strong>, every other tag is reduced to its text.
 */
import type { ReactNode } from 'react'

export function RichText({ text }: { text: string }) {
  const doc = new DOMParser().parseFromString(`<body>${text}</body>`, 'text/html')
  return <>{Array.from(doc.body.childNodes).map(toReact)}</>
}

function toReact(node: ChildNode, i: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const children = Array.from(node.childNodes).map(toReact)
  return (node as Element).tagName === 'B' ? <strong key={i}>{children}</strong> : <span key={i}>{children}</span>
}

