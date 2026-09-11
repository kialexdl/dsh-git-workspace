export type DiffLineKind = 'meta' | 'hunk' | 'context' | 'addition' | 'deletion' | 'note'

export interface DiffLine {
  kind: DiffLineKind
  oldLine?: number
  newLine?: number
  text: string
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Convert a unified Git patch into rows with stable old/new line numbers. */
export function parseUnifiedDiff(value: string): DiffLine[] {
  if (value.trim() === '') return []
  const rawLines = value.replace(/\r\n/g, '\n').split('\n')
  if (rawLines.at(-1) === '') rawLines.pop()
  const lines: DiffLine[] = []
  let oldLine: number | undefined
  let newLine: number | undefined

  for (const raw of rawLines) {
    const hunk = HUNK.exec(raw)
    if (hunk !== null) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      lines.push({ kind: 'hunk', text: raw })
      continue
    }
    if (oldLine !== undefined && newLine !== undefined && raw.startsWith('+') && !raw.startsWith('+++')) {
      lines.push({ kind: 'addition', newLine, text: raw.slice(1) })
      newLine += 1
      continue
    }
    if (oldLine !== undefined && newLine !== undefined && raw.startsWith('-') && !raw.startsWith('---')) {
      lines.push({ kind: 'deletion', oldLine, text: raw.slice(1) })
      oldLine += 1
      continue
    }
    if (oldLine !== undefined && newLine !== undefined && raw.startsWith(' ')) {
      lines.push({ kind: 'context', oldLine, newLine, text: raw.slice(1) })
      oldLine += 1
      newLine += 1
      continue
    }
    if (raw.startsWith('\\ ')) {
      lines.push({ kind: 'note', text: raw })
      continue
    }
    lines.push({ kind: 'meta', text: raw })
  }
  return lines
}

export function DiffViewer({ text }: { text: string }) {
  const lines = parseUnifiedDiff(text)
  if (lines.length === 0) return <div className="dgw-diff-empty">没有可显示的文本差异。</div>
  return (
    <div className="dgw-diff" role="table" aria-label="Git Diff">
      {lines.map((line, index) => (
        <div className={`dgw-diff-line ${line.kind}`} role="row" key={`${String(index)}:${line.kind}`}>
          <span className="dgw-line-number" aria-hidden="true">{line.oldLine ?? ''}</span>
          <span className="dgw-line-number" aria-hidden="true">{line.newLine ?? ''}</span>
          <code>{line.text === '' ? ' ' : line.text}</code>
        </div>
      ))}
    </div>
  )
}
