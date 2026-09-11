import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '../src/client/DiffViewer.tsx'

describe('human-readable diff parser', () => {
  it('assigns old and new line numbers to unified diff rows', () => {
    const rows = parseUnifiedDiff([
      'diff --git a/file.txt b/file.txt',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -2,3 +2,3 @@',
      ' unchanged',
      '-old value',
      '+new value',
      ' tail',
      '',
    ].join('\n'))

    expect(rows.filter(row => row.kind === 'context')).toEqual([
      { kind: 'context', oldLine: 2, newLine: 2, text: 'unchanged' },
      { kind: 'context', oldLine: 4, newLine: 4, text: 'tail' },
    ])
    expect(rows.find(row => row.kind === 'deletion')).toMatchObject({ oldLine: 3, text: 'old value' })
    expect(rows.find(row => row.kind === 'addition')).toMatchObject({ newLine: 3, text: 'new value' })
  })

  it('renders a synthetic untracked-file patch as additions', () => {
    const rows = parseUnifiedDiff('new file mode 100644\n@@ -0,0 +1,2 @@\n+first\n+second\n')
    expect(rows.filter(row => row.kind === 'addition').map(row => [row.newLine, row.text]))
      .toEqual([[1, 'first'], [2, 'second']])
  })
})
