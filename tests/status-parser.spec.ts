import { describe, expect, it } from 'vitest'
import { parsePorcelainV2, summaryFromStatus } from '../src/host/status-parser.ts'

describe('porcelain v2 parser', () => {
  it('parses branch metadata, ordinary, renamed, untracked, and conflicted rows', () => {
    const records = [
      '# branch.oid 0123456789abcdef',
      '# branch.head feature/test',
      '# branch.upstream origin/feature/test',
      '# branch.ab +3 -2',
      '1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb src/staged.ts',
      '1 .M N... 100644 100644 100644 aaaaaaa bbbbbbb src/working.ts',
      '2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 src/new name.ts',
      'src/old name.ts',
      '? notes/新文件.txt',
      'u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc conflict.txt',
      '',
    ]
    const parsed = parsePorcelainV2(Buffer.from(records.join('\0')))
    expect(parsed).toMatchObject({
      branch: 'feature/test', upstream: 'origin/feature/test', ahead: 3, behind: 2, detached: false,
    })
    expect(parsed.changes).toHaveLength(5)
    expect(parsed.changes[0]).toMatchObject({ path: 'src/staged.ts', staged: true, unstaged: false })
    expect(parsed.changes[2]).toMatchObject({ path: 'src/new name.ts', originalPath: 'src/old name.ts', kind: 'renamed' })
    expect(parsed.changes[3]).toMatchObject({ path: 'notes/新文件.txt', kind: 'untracked' })
    expect(parsed.changes[4]).toMatchObject({ path: 'conflict.txt', conflict: true })
    expect(summaryFromStatus({ repoId: 'r', name: 'repo', relativePath: '.', remoteCount: 1, status: parsed }))
      .toMatchObject({ staged: 3, unstaged: 3, conflicts: 1, clean: false, ahead: 3, behind: 2 })
  })
})
