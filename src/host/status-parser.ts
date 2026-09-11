import type { ChangeKind, FileChange, RepoSummary } from '../shared/protocol.ts'

export interface ParsedStatus {
  branch: string
  detached: boolean
  head?: string
  upstream?: string
  ahead: number
  behind: number
  changes: FileChange[]
}

function kindFor(index: string, worktree: string): ChangeKind {
  const value = index !== '.' ? index : worktree
  if (value === '?') return 'untracked'
  if (value === '!') return 'ignored'
  if (value === 'A') return 'added'
  if (value === 'D') return 'deleted'
  if (value === 'R') return 'renamed'
  if (value === 'C') return 'copied'
  if (value === 'U' || (index !== '.' && worktree !== '.' && index !== worktree)) return 'conflict'
  return 'modified'
}

function change(path: string, xy: string, originalPath?: string, unmerged = false): FileChange {
  const indexStatus = xy[0] ?? '.'
  const worktreeStatus = xy[1] ?? '.'
  const conflict = unmerged || indexStatus === 'U' || worktreeStatus === 'U'
  return {
    path,
    ...(originalPath === undefined ? {} : { originalPath }),
    indexStatus,
    worktreeStatus,
    kind: conflict ? 'conflict' : kindFor(indexStatus, worktreeStatus),
    staged: indexStatus !== '.' && indexStatus !== '?',
    unstaged: worktreeStatus !== '.',
    conflict,
  }
}

export function parsePorcelainV2(buffer: Buffer): ParsedStatus {
  const records = buffer.toString('utf8').split('\0')
  let branch = '(no branch)'
  let detached = false
  let head: string | undefined
  let upstream: string | undefined
  let ahead = 0
  let behind = 0
  const changes: FileChange[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? ''
    if (record === '') continue
    if (record.startsWith('# branch.head ')) {
      branch = record.slice(14)
      detached = branch === '(detached)'
      continue
    }
    if (record.startsWith('# branch.oid ')) {
      const value = record.slice(13)
      if (value !== '(initial)') head = value
      continue
    }
    if (record.startsWith('# branch.upstream ')) {
      upstream = record.slice(18)
      continue
    }
    if (record.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record)
      if (match !== null) {
        ahead = Number(match[1])
        behind = Number(match[2])
      }
      continue
    }
    if (record.startsWith('1 ')) {
      const match = /^1 (\S{2}) \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/s.exec(record)
      if (match !== null) changes.push(change(match[2]!, match[1]!))
      continue
    }
    if (record.startsWith('2 ')) {
      const match = /^2 (\S{2}) \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/s.exec(record)
      if (match !== null) {
        const originalPath = records[index + 1] ?? ''
        index += 1
        changes.push(change(match[2]!, match[1]!, originalPath))
      }
      continue
    }
    if (record.startsWith('u ')) {
      const match = /^u (\S{2}) \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/s.exec(record)
      if (match !== null) changes.push(change(match[2]!, match[1]!, undefined, true))
      continue
    }
    if (record.startsWith('? ')) changes.push(change(record.slice(2), '??'))
    if (record.startsWith('! ')) changes.push(change(record.slice(2), '!!'))
  }
  return { branch, detached, head, upstream, ahead, behind, changes }
}

export function summaryFromStatus(input: {
  repoId: string
  name: string
  relativePath: string
  remoteCount: number
  status: ParsedStatus
}): RepoSummary {
  const { status } = input
  const staged = status.changes.filter(item => item.staged).length
  const unstaged = status.changes.filter(item => item.unstaged).length
  const conflicts = status.changes.filter(item => item.conflict).length
  return {
    repoId: input.repoId,
    name: input.name,
    relativePath: input.relativePath,
    branch: status.branch,
    detached: status.detached,
    ...(status.head === undefined ? {} : { head: status.head }),
    ...(status.upstream === undefined ? {} : { upstream: status.upstream }),
    ahead: status.ahead,
    behind: status.behind,
    staged,
    unstaged,
    conflicts,
    clean: staged === 0 && unstaged === 0 && conflicts === 0,
    remoteCount: input.remoteCount,
  }
}
