/** Plugin RPC namespace on the authenticated Connection carrier owned by this plugin. */
// DSH only accepts one path segment in a channel; the namespace belongs in method.
export const RPC_CHANNEL = '/api'
export function rpcMethod(endpoint: string): string {
  return `git-workspace/${endpoint}`
}

export const RPC = {
  workspaces: 'workspaces',
  scan: 'scan',
  detail: 'detail',
  diff: 'diff',
  stage: 'stage',
  unstage: 'unstage',
  commit: 'commit',
  commitDetail: 'commit/detail',
  commitDiff: 'commit/diff',
  branches: 'branches',
  checkout: 'checkout',
  createBranch: 'branch/create',
  deleteBranch: 'branch/delete',
  remotes: 'remotes',
  addRemote: 'remote/add',
  setRemoteUrl: 'remote/set-url',
  removeRemote: 'remote/remove',
  fetch: 'fetch',
  pull: 'pull',
  push: 'push',
  publish: 'publish',
  batch: 'batch',
} as const

export interface WorkspaceView {
  workspaceId: string
  title: string
  path: string
}

export interface RepoSummary {
  repoId: string
  name: string
  relativePath: string
  branch: string
  detached: boolean
  head?: string
  upstream?: string
  ahead: number
  behind: number
  staged: number
  unstaged: number
  conflicts: number
  clean: boolean
  remoteCount: number
}

export interface WorkspaceSnapshot {
  workspace: WorkspaceView
  repositories: RepoSummary[]
  scannedAt: string
}

export type ChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'ignored' | 'conflict'

export interface FileChange {
  path: string
  originalPath?: string
  indexStatus: string
  worktreeStatus: string
  kind: ChangeKind
  staged: boolean
  unstaged: boolean
  conflict: boolean
}

export interface CommitRow {
  hash: string
  shortHash: string
  parents: string[]
  author: string
  authoredAt: string
  subject: string
  refs: string[]
}

export interface CommitFileChange {
  status: string
  path: string
  originalPath?: string
}

export interface CommitDetail {
  hash: string
  parents: string[]
  author: string
  authoredAt: string
  message: string
  files: CommitFileChange[]
}

export type ProxyAction = 'proxy' | 'direct' | 'inherit' | 'block'

export interface ProxyDecision {
  action: ProxyAction
  source: 'blockHosts' | 'directHosts' | 'proxyHosts' | 'defaultAction' | 'unsupported'
  host?: string
  endpoint?: string
  reason: string
}

export interface RemoteView {
  name: string
  fetchUrl: string
  pushUrls: string[]
  fetchDecision: ProxyDecision
  pushDecisions: ProxyDecision[]
}

export interface RepositoryDetail {
  summary: RepoSummary
  changes: FileChange[]
  commits: CommitRow[]
  remotes: RemoteView[]
}

export interface BranchView {
  name: string
  current: boolean
  remote: boolean
  remoteName?: string
  localName?: string
  upstream?: string
  ahead: number
  behind: number
}

export interface OperationResult {
  repoId: string
  repoName: string
  action: 'fetch' | 'pull' | 'push'
  ok: boolean
  message: string
  decision?: ProxyDecision
}

export interface BatchResult {
  startedAt: string
  finishedAt: string
  results: OperationResult[]
}

export interface NetworkSettings {
  proxyUrl?: string
  proxyHosts?: string[]
  directHosts?: string[]
  blockHosts?: string[]
  defaultAction?: Exclude<ProxyAction, 'proxy'>
}

export interface RpcFailure {
  code: string
  message: string
  details: Record<string, unknown>
}

export type RpcEnvelope<T> = { ok: true; value: T } | { ok: false; error: RpcFailure }
