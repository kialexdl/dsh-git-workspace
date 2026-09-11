import { createHash } from 'node:crypto'
import { lstat, readFile, readlink, readdir, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import type {
  BatchResult,
  BranchView,
  CommitDetail,
  CommitFileChange,
  CommitRow,
  FileChange,
  NetworkSettings,
  OperationResult,
  RemoteView,
  RepositoryDetail,
  RepoSummary,
  WorkspaceSnapshot,
  WorkspaceView,
} from '../shared/protocol.ts'
import { GitWorkspaceError } from './errors.ts'
import { gitText, runGit } from './git-process.ts'
import { decideProxy, networkExecution } from './proxy-policy.ts'
import { parsePorcelainV2, summaryFromStatus } from './status-parser.ts'

const SAFE_REMOTE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const DIFF_OUTPUT_LIMIT = 4 * 1024 * 1024
const DEFAULT_IGNORES = new Set([
  '.git', 'node_modules', '.pnpm-store', '.cache', '.next', '.nuxt', '.turbo',
  'dist', 'build', 'coverage', 'target', 'vendor', '.venv', 'venv', '__pycache__',
])

export interface WorkspaceRecord {
  id: unknown
  path: string
  title?: string
}

export interface WorkspaceRegistryFace {
  list(): WorkspaceRecord[]
  get(id: never): WorkspaceRecord | undefined
}

interface RegisteredRepo {
  repoId: string
  workspaceId: string
  path: string
  name: string
  relativePath: string
}

export interface RepositoryServiceOptions {
  scanDepth: () => number
  ignoredDirectories: () => string[]
  networkSettings: () => NetworkSettings
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!isAbsolute(rel) && !rel.startsWith(`..${sep}`) && rel !== '..')
}

function repoKey(workspaceId: string, canonicalPath: string): string {
  return createHash('sha256').update(workspaceId).update('\0').update(canonicalPath).digest('hex').slice(0, 20)
}

function displayPath(root: string, repo: string): string {
  const value = relative(root, repo)
  return value === '' ? '.' : value.split(sep).join('/')
}

function validateRemoteName(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REMOTE.test(value)) {
    throw new GitWorkspaceError('INVALID_REMOTE', 'Remote 名称不合法。')
  }
  return value
}

function validateUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 4096 || /[\0\r\n]/.test(value)) {
    throw new GitWorkspaceError('INVALID_URL', 'Remote URL 不合法。')
  }
  return value.trim()
}

function validateBranch(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 255 || /[\0\r\n]/.test(value)) {
    throw new GitWorkspaceError('INVALID_BRANCH', '分支名称不合法。')
  }
  return value.trim()
}

function remoteForUpstream(upstream: string | undefined, names: readonly string[]): string | undefined {
  if (upstream === undefined) return names.includes('origin') ? 'origin' : names[0]
  return names.find(name => upstream === name || upstream.startsWith(`${name}/`))
}

function displayDiffPath(value: string): string {
  return value.replace(/[\r\n]/g, '\ufffd')
}

function addedFileDiff(filePath: string, content: Buffer, mode = '100644'): string {
  const display = displayDiffPath(filePath)
  const header = [
    `diff --git a/${display} b/${display}`,
    `new file mode ${mode}`,
    '--- /dev/null',
    `+++ b/${display}`,
  ]
  if (content.includes(0)) return [...header, `Binary file /dev/null and b/${display} differ`, ''].join('\n')
  const text = content.toString('utf8')
  if (text === '') return [...header, ''].join('\n')
  const endsWithNewline = text.endsWith('\n')
  const lines = text.split('\n')
  if (endsWithNewline) lines.pop()
  const body = lines.map(line => `+${line.endsWith('\r') ? line.slice(0, -1) : line}`)
  return [
    ...header,
    `@@ -0,0 +1,${String(lines.length)} @@`,
    ...body,
    ...(endsWithNewline ? [] : ['\\ No newline at end of file']),
    '',
  ].join('\n')
}

function parseCommitFiles(output: Buffer): CommitFileChange[] {
  const fields = output.toString('utf8').split('\0')
  const files: CommitFileChange[] = []
  for (let index = 0; index < fields.length;) {
    const status = fields[index++] ?? ''
    if (status === '') continue
    if (status.startsWith('R') || status.startsWith('C')) {
      const originalPath = fields[index++] ?? ''
      const path = fields[index++] ?? ''
      if (originalPath !== '' && path !== '') files.push({ status, path, originalPath })
      continue
    }
    const path = fields[index++] ?? ''
    if (path !== '') files.push({ status, path })
  }
  return files
}

export class RepositoryService {
  private readonly byWorkspace = new Map<string, Map<string, RegisteredRepo>>()

  constructor(
    private readonly workspaces: WorkspaceRegistryFace,
    private readonly options: RepositoryServiceOptions,
  ) {}

  listWorkspaces(): WorkspaceView[] {
    return this.workspaces.list().map(workspace => ({
      workspaceId: String(workspace.id),
      title: workspace.title?.trim() || basename(workspace.path),
      path: workspace.path,
    }))
  }

  async scan(workspaceId: string, signal?: AbortSignal): Promise<WorkspaceSnapshot> {
    const workspace = await this.workspace(workspaceId)
    const candidates = await this.discover(workspace.path)
    const registry = new Map<string, RegisteredRepo>()
    for (const candidate of candidates) {
      if (signal?.aborted === true) throw signal.reason
      const result = await runGit(['rev-parse', '--show-toplevel'], { cwd: candidate, signal, allowFailure: true })
      if (result.exitCode !== 0) continue
      const rawTop = result.stdout.toString('utf8').replace(/[\r\n]+$/, '')
      if (rawTop === '') continue
      let top: string
      try {
        top = await realpath(rawTop)
      } catch {
        continue
      }
      if (!isInside(workspace.path, top)) continue
      const repoId = repoKey(workspaceId, top)
      registry.set(repoId, {
        repoId,
        workspaceId,
        path: top,
        name: basename(top),
        relativePath: displayPath(workspace.path, top),
      })
    }
    this.byWorkspace.set(workspaceId, registry)
    const repositories: RepoSummary[] = []
    for (const repo of [...registry.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
      repositories.push(await this.summary(repo, signal))
    }
    return {
      workspace: {
        workspaceId,
        title: workspace.title?.trim() || basename(workspace.path),
        path: workspace.path,
      },
      repositories,
      scannedAt: new Date().toISOString(),
    }
  }

  async detail(workspaceId: string, repoId: string, signal?: AbortSignal): Promise<RepositoryDetail> {
    const repo = await this.repo(workspaceId, repoId, signal)
    const [status, commits, remotes] = await Promise.all([
      this.status(repo, signal),
      this.history(repo, 100, signal),
      this.remotesFor(repo, signal),
    ])
    return {
      summary: summaryFromStatus({
        repoId: repo.repoId,
        name: repo.name,
        relativePath: repo.relativePath,
        remoteCount: remotes.length,
        status,
      }),
      changes: status.changes,
      commits,
      remotes,
    }
  }

  async diff(workspaceId: string, repoId: string, filePath: string, staged: boolean, signal?: AbortSignal): Promise<string> {
    const repo = await this.repo(workspaceId, repoId, signal)
    const status = await this.status(repo, signal)
    const change = status.changes.find(item => item.path === filePath || item.originalPath === filePath)
    if (change === undefined) {
      throw new GitWorkspaceError('PATH_NOT_CHANGED', '只能查看当前 Git 状态中出现的文件。')
    }
    if (!staged && change.kind === 'untracked') {
      const absolute = resolve(repo.path, filePath)
      if (!isInside(repo.path, absolute)) throw new GitWorkspaceError('INVALID_PATH', '文件不在仓库内。')
      const stat = await lstat(absolute)
      if (stat.isSymbolicLink()) {
        return addedFileDiff(filePath, Buffer.from(await readlink(absolute)), '120000')
      }
      if (!stat.isFile()) throw new GitWorkspaceError('INVALID_PATH', '未跟踪路径不是普通文件。')
      if (stat.size > DIFF_OUTPUT_LIMIT) throw new GitWorkspaceError('OUTPUT_LIMIT', `文件超过 ${String(DIFF_OUTPUT_LIMIT)} 字节 Diff 限制。`)
      return addedFileDiff(filePath, await readFile(absolute))
    }
    const args = ['diff', '--no-ext-diff', '--no-color', ...(staged ? ['--cached'] : []), '--', filePath]
    return gitText(args, { cwd: repo.path, signal, outputLimit: DIFF_OUTPUT_LIMIT })
  }

  async stage(workspaceId: string, repoId: string, paths: string[], signal?: AbortSignal): Promise<RepositoryDetail> {
    const repo = await this.repo(workspaceId, repoId, signal)
    const selected = await this.validateChangedPaths(repo, paths, signal)
    await runGit(['add', '--', ...selected], { cwd: repo.path, signal })
    return this.detail(workspaceId, repoId, signal)
  }

  async unstage(workspaceId: string, repoId: string, paths: string[], signal?: AbortSignal): Promise<RepositoryDetail> {
    const repo = await this.repo(workspaceId, repoId, signal)
    const selected = await this.validateChangedPaths(repo, paths, signal)
    const restore = await runGit(['restore', '--staged', '--', ...selected], { cwd: repo.path, signal, allowFailure: true })
    if (restore.exitCode !== 0) {
      const reset = await runGit(['reset', '-q', 'HEAD', '--', ...selected], { cwd: repo.path, signal, allowFailure: true })
      if (reset.exitCode !== 0) await runGit(['rm', '--cached', '-r', '--ignore-unmatch', '--', ...selected], { cwd: repo.path, signal })
    }
    return this.detail(workspaceId, repoId, signal)
  }

  async commit(workspaceId: string, repoId: string, message: string, signal?: AbortSignal): Promise<RepositoryDetail> {
    const repo = await this.repo(workspaceId, repoId, signal)
    const normalized = message.trim()
    if (normalized === '' || normalized.length > 10_000 || normalized.includes('\0')) {
      throw new GitWorkspaceError('INVALID_MESSAGE', '提交信息不能为空，且不得超过 10000 个字符。')
    }
    const status = await this.status(repo, signal)
    if (!status.changes.some(change => change.staged)) {
      throw new GitWorkspaceError('NOTHING_STAGED', '没有已暂存的修改；提交不会自动执行 git add。')
    }
    if (status.changes.some(change => change.conflict)) {
      throw new GitWorkspaceError('CONFLICTS', '仓库仍有冲突，不能提交。')
    }
    await runGit(['commit', '-F', '-'], { cwd: repo.path, signal, stdin: normalized })
    return this.detail(workspaceId, repoId, signal)
  }

  async commitDetail(workspaceId: string, repoId: string, hash: string, signal?: AbortSignal): Promise<CommitDetail> {
    const repo = await this.repo(workspaceId, repoId, signal)
    if (!/^[0-9a-f]{40,64}$/i.test(hash)) throw new GitWorkspaceError('INVALID_COMMIT', '提交哈希不合法。')
    const known = await this.history(repo, 100, signal)
    if (!known.some(commit => commit.hash === hash)) throw new GitWorkspaceError('UNKNOWN_COMMIT', '提交不在当前历史列表中，请刷新后重试。')
    const format = '%H%x00%P%x00%an%x00%aI%x00%B%x00'
    const [show, changed] = await Promise.all([
      runGit(['show', '-s', `--format=${format}`, hash], { cwd: repo.path, signal, outputLimit: DIFF_OUTPUT_LIMIT }),
      runGit(['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-z', '--find-renames', hash], {
        cwd: repo.path,
        signal,
        outputLimit: DIFF_OUTPUT_LIMIT,
      }),
    ])
    const [resolvedHash = hash, parents = '', author = '', authoredAt = '', message = ''] = show.stdout.toString('utf8').split('\0')
    return {
      hash: resolvedHash,
      parents: parents === '' ? [] : parents.split(' ').filter(Boolean),
      author,
      authoredAt,
      message: message.replace(/\n+$/, ''),
      files: parseCommitFiles(changed.stdout),
    }
  }

  async commitDiff(workspaceId: string, repoId: string, hash: string, filePath: string, signal?: AbortSignal): Promise<string> {
    const repo = await this.repo(workspaceId, repoId, signal)
    const detail = await this.commitDetail(workspaceId, repoId, hash, signal)
    const file = detail.files.find(item => item.path === filePath || item.originalPath === filePath)
    if (file === undefined) {
      throw new GitWorkspaceError('PATH_NOT_IN_COMMIT', '只能查看该提交变更文件列表中的文件。')
    }
    const paths = [...new Set([file.originalPath, file.path].filter((value): value is string => value !== undefined))]
    return gitText([
      'show', '--format=', '--no-ext-diff', '--no-color', '--find-renames', '--find-copies', detail.hash, '--', ...paths,
    ], { cwd: repo.path, signal, outputLimit: DIFF_OUTPUT_LIMIT })
  }

  async branches(workspaceId: string, repoId: string, signal?: AbortSignal): Promise<BranchView[]> {
    const repo = await this.repo(workspaceId, repoId, signal)
    const localFormat = '%(HEAD)%1f%(refname:short)%1f%(upstream:short)%1f%(upstream:track,nobracket)%00'
    const remoteFormat = '%(refname:short)%1f%(symref)%00'
    const [localOutput, remoteOutput] = await Promise.all([
      gitText(['for-each-ref', `--format=${localFormat}`, 'refs/heads'], { cwd: repo.path, signal }),
      gitText(['for-each-ref', `--format=${remoteFormat}`, 'refs/remotes'], { cwd: repo.path, signal }),
    ])
    const localBranches: BranchView[] = localOutput.split('\0').map(record => record.replace(/^\r?\n/, '')).filter(Boolean).map(record => {
      const [head = '', name = '', upstream = '', track = ''] = record.split('\x1f')
      const ahead = /ahead (\d+)/.exec(track)?.[1]
      const behind = /behind (\d+)/.exec(track)?.[1]
      return {
        name,
        current: head === '*',
        remote: false,
        ...(upstream === '' ? {} : { upstream }),
        ahead: ahead === undefined ? 0 : Number(ahead),
        behind: behind === undefined ? 0 : Number(behind),
      }
    }).filter(branch => branch.name !== '')
    const remoteBranches: BranchView[] = remoteOutput.split('\0').map(record => record.replace(/^\r?\n/, '')).filter(Boolean).map(record => {
      const [name = '', symbolicTarget = ''] = record.split('\x1f')
      const separator = name.indexOf('/')
      return {
        name,
        current: false,
        remote: true,
        ...(separator < 1 ? {} : { remoteName: name.slice(0, separator), localName: name.slice(separator + 1) }),
        ahead: 0,
        behind: 0,
        symbolicTarget,
      }
    }).filter(branch => branch.name !== '' && branch.remoteName !== undefined && branch.localName !== '' && (branch as BranchView & { symbolicTarget?: string }).symbolicTarget === '').map(branch => {
      const { symbolicTarget: _symbolicTarget, ...view } = branch as BranchView & { symbolicTarget?: string }
      return view
    })
    return [...localBranches, ...remoteBranches].sort((a, b) => Number(b.current) - Number(a.current) || Number(a.remote) - Number(b.remote) || a.name.localeCompare(b.name))
  }

  async checkout(workspaceId: string, repoId: string, branch: string, remote = false, signal?: AbortSignal): Promise<RepositoryDetail> {
    const repo = await this.repo(workspaceId, repoId, signal)
    const name = validateBranch(branch)
    const known = await this.branches(workspaceId, repoId, signal)
    const target = known.find(item => item.name === name && item.remote === remote)
    if (target === undefined) throw new GitWorkspaceError('UNKNOWN_BRANCH', remote ? '远程分支不存在，请先 Fetch 后重试。' : '本地分支不存在。')
    const status = await this.status(repo, signal)
    if (!status.changes.every(change => !change.conflict)) throw new GitWorkspaceError('CONFLICTS', '冲突状态下不能切换分支。')
    if (target.remote) {
      const localName = validateBranch(target.localName)
      if (known.some(item => !item.remote && item.name === localName)) {
        throw new GitWorkspaceError('LOCAL_BRANCH_EXISTS', `本地分支 “${localName}” 已存在，请从本地分支列表切换。`)
      }
      await runGit(['switch', '-c', localName, '--track', name], { cwd: repo.path, signal })
    } else {
      await runGit(['switch', name], { cwd: repo.path, signal })
    }
    return this.detail(workspaceId, repoId, signal)
  }

  async createBranch(workspaceId: string, repoId: string, branch: string, signal?: AbortSignal): Promise<RepositoryDetail> {
    const repo = await this.repo(workspaceId, repoId, signal)
    const name = validateBranch(branch)
    await runGit(['check-ref-format', '--branch', name], { cwd: repo.path, signal })
    await runGit(['switch', '-c', name], { cwd: repo.path, signal })
    return this.detail(workspaceId, repoId, signal)
  }

  async deleteBranch(workspaceId: string, repoId: string, branch: string, signal?: AbortSignal): Promise<RepositoryDetail> {
    const repo = await this.repo(workspaceId, repoId, signal)
    const name = validateBranch(branch)
    const known = await this.branches(workspaceId, repoId, signal)
    const target = known.find(item => !item.remote && item.name === name)
    if (target === undefined) throw new GitWorkspaceError('UNKNOWN_BRANCH', '分支不存在。')
    if (target.current) throw new GitWorkspaceError('CURRENT_BRANCH', '不能删除当前分支。')
    await runGit(['branch', '-d', name], { cwd: repo.path, signal })
    return this.detail(workspaceId, repoId, signal)
  }

  async remotes(workspaceId: string, repoId: string, signal?: AbortSignal): Promise<RemoteView[]> {
    return this.remotesFor(await this.repo(workspaceId, repoId, signal), signal)
  }

  async addRemote(workspaceId: string, repoId: string, nameValue: unknown, urlValue: unknown, signal?: AbortSignal): Promise<RepositoryDetail> {
    const repo = await this.repo(workspaceId, repoId, signal)
    const name = validateRemoteName(nameValue)
    const url = validateUrl(urlValue)
    await runGit(['remote', 'add', name, url], { cwd: repo.path, signal })
    return this.detail(workspaceId, repoId, signal)
  }

  async removeRemote(workspaceId: string, repoId: string, nameValue: unknown, signal?: AbortSignal): Promise<RepositoryDetail> {
    const repo = await this.repo(workspaceId, repoId, signal)
    const name = validateRemoteName(nameValue)
    await this.requireRemote(repo, name, signal)
    await runGit(['remote', 'remove', name], { cwd: repo.path, signal })
    return this.detail(workspaceId, repoId, signal)
  }

  async setRemoteUrl(workspaceId: string, repoId: string, nameValue: unknown, urlValue: unknown, push: boolean, signal?: AbortSignal): Promise<RepositoryDetail> {
    const repo = await this.repo(workspaceId, repoId, signal)
    const name = validateRemoteName(nameValue)
    const url = validateUrl(urlValue)
    await this.requireRemote(repo, name, signal)
    await runGit(['remote', 'set-url', ...(push ? ['--push'] : []), name, url], { cwd: repo.path, signal })
    return this.detail(workspaceId, repoId, signal)
  }

  async fetch(workspaceId: string, repoId: string, remoteValue?: unknown, signal?: AbortSignal): Promise<RepositoryDetail> {
    const repo = await this.repo(workspaceId, repoId, signal)
    const remotes = await this.remoteRecords(repo, signal)
    const selected = remoteValue === undefined
      ? remotes
      : [await this.requireRemote(repo, validateRemoteName(remoteValue), signal)]
    if (selected.length === 0) throw new GitWorkspaceError('NO_REMOTE', '仓库没有 remote。')
    for (const remote of selected) {
      const execution = networkExecution(remote.fetchUrl, this.options.networkSettings())
      await runGit([...execution.gitConfigArgs, 'fetch', '--prune', remote.name], {
        cwd: repo.path, signal, env: execution.env,
      })
    }
    return this.detail(workspaceId, repoId, signal)
  }

  async pull(workspaceId: string, repoId: string, remoteValue?: unknown, signal?: AbortSignal): Promise<RepositoryDetail> {
    const repo = await this.repo(workspaceId, repoId, signal)
    const status = await this.status(repo, signal)
    if (status.changes.some(change => change.conflict)) throw new GitWorkspaceError('UNRESOLVED_CONFLICT', '请先解决现有冲突，再执行 Pull。')
    if (status.detached) throw new GitWorkspaceError('DETACHED_HEAD', 'Detached HEAD 状态下不能 Pull。')
    const remotes = await this.remoteRecords(repo, signal)
    const name = remoteValue === undefined
      ? remoteForUpstream(status.upstream, remotes.map(item => item.name))
      : validateRemoteName(remoteValue)
    if (name === undefined) throw new GitWorkspaceError('NO_REMOTE', '没有可用于 Pull 的 remote。')
    const remote = await this.requireRemote(repo, name, signal)
    const execution = networkExecution(remote.fetchUrl, this.options.networkSettings())
    const upstreamBranch = status.upstream?.startsWith(`${remote.name}/`)
      ? status.upstream.slice(remote.name.length + 1)
      : status.branch
    await runGit([...execution.gitConfigArgs, 'pull', '--ff-only', '--no-rebase', '--no-autostash', remote.name, upstreamBranch], {
      cwd: repo.path, signal, env: execution.env,
    })
    return this.detail(workspaceId, repoId, signal)
  }

  async push(workspaceId: string, repoId: string, remoteValue?: unknown, signal?: AbortSignal): Promise<RepositoryDetail> {
    const repo = await this.repo(workspaceId, repoId, signal)
    const status = await this.status(repo, signal)
    if (status.detached) throw new GitWorkspaceError('DETACHED_HEAD', 'Detached HEAD 状态下不能 Push。')
    const remotes = await this.remoteRecords(repo, signal)
    const name = remoteValue === undefined
      ? remoteForUpstream(status.upstream, remotes.map(item => item.name))
      : validateRemoteName(remoteValue)
    if (name === undefined) throw new GitWorkspaceError('NO_UPSTREAM', '当前分支没有 upstream；请使用“发布分支”。')
    const remote = await this.requireRemote(repo, name, signal)
    const pushUrl = remote.pushUrls[0] ?? remote.fetchUrl
    const execution = networkExecution(pushUrl, this.options.networkSettings())
    await runGit([...execution.gitConfigArgs, 'push', remote.name, status.branch], {
      cwd: repo.path, signal, env: execution.env,
    })
    return this.detail(workspaceId, repoId, signal)
  }

  async publish(workspaceId: string, repoId: string, remoteValue: unknown, signal?: AbortSignal): Promise<RepositoryDetail> {
    const repo = await this.repo(workspaceId, repoId, signal)
    const status = await this.status(repo, signal)
    if (status.detached) throw new GitWorkspaceError('DETACHED_HEAD', 'Detached HEAD 状态下不能发布分支。')
    const remote = await this.requireRemote(repo, validateRemoteName(remoteValue), signal)
    const execution = networkExecution(remote.pushUrls[0] ?? remote.fetchUrl, this.options.networkSettings())
    await runGit([...execution.gitConfigArgs, 'push', '-u', remote.name, status.branch], {
      cwd: repo.path, signal, env: execution.env,
    })
    return this.detail(workspaceId, repoId, signal)
  }

  async batch(workspaceId: string, repoIds: string[], action: 'fetch' | 'pull' | 'push', signal?: AbortSignal): Promise<BatchResult> {
    if (repoIds.length === 0 || repoIds.length > 100) throw new GitWorkspaceError('INVALID_BATCH', '请选择 1 到 100 个仓库。')
    const unique = [...new Set(repoIds)]
    const startedAt = new Date().toISOString()
    const results: OperationResult[] = []
    for (const repoId of unique) {
      let repoName = repoId
      try {
        const repo = await this.repo(workspaceId, repoId, signal)
        repoName = repo.name
        if (action === 'fetch') await this.fetch(workspaceId, repoId, undefined, signal)
        else if (action === 'pull') await this.pull(workspaceId, repoId, undefined, signal)
        else await this.push(workspaceId, repoId, undefined, signal)
        results.push({ repoId, repoName, action, ok: true, message: `${action} 完成。` })
      } catch (error) {
        results.push({
          repoId,
          repoName,
          action,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return { startedAt, finishedAt: new Date().toISOString(), results }
  }

  private async workspace(workspaceId: string): Promise<{ id: unknown; path: string; title?: string }> {
    const raw = this.workspaces.get(workspaceId as never)
    if (raw === undefined) throw new GitWorkspaceError('WORKSPACE_NOT_FOUND', 'DSH workspace 不存在或已被移除。')
    const path = await realpath(raw.path)
    return { id: raw.id, path, ...(raw.title === undefined ? {} : { title: raw.title }) }
  }

  private async repo(workspaceId: string, repoId: string, signal?: AbortSignal): Promise<RegisteredRepo> {
    let registry = this.byWorkspace.get(workspaceId)
    if (registry === undefined) {
      await this.scan(workspaceId, signal)
      registry = this.byWorkspace.get(workspaceId)
    }
    const repo = registry?.get(repoId)
    if (repo === undefined) throw new GitWorkspaceError('REPOSITORY_NOT_FOUND', '仓库不存在或扫描结果已变化，请重新扫描。')
    const workspace = await this.workspace(workspaceId)
    const canonical = await realpath(repo.path)
    if (canonical !== repo.path || !isInside(workspace.path, canonical)) {
      throw new GitWorkspaceError('REPOSITORY_MOVED', '仓库路径已变化或已越出 workspace，请重新扫描。')
    }
    return repo
  }

  private async discover(root: string): Promise<string[]> {
    const found: string[] = []
    const ignore = new Set([...DEFAULT_IGNORES, ...this.options.ignoredDirectories()])
    const maxDepth = Math.max(0, Math.min(12, Math.floor(this.options.scanDepth())))
    const visit = async (directory: string, depth: number): Promise<void> => {
      let entries
      try {
        entries = await readdir(directory, { withFileTypes: true })
      } catch {
        return
      }
      if (entries.some(entry => entry.name === '.git' && (entry.isDirectory() || entry.isFile()))) found.push(directory)
      if (depth >= maxDepth) return
      await Promise.all(entries.map(async entry => {
        if (!entry.isDirectory() || entry.isSymbolicLink() || ignore.has(entry.name)) return
        await visit(resolve(directory, entry.name), depth + 1)
      }))
    }
    await visit(root, 0)
    return found
  }

  private async status(repo: RegisteredRepo, signal?: AbortSignal) {
    const result = await runGit(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], { cwd: repo.path, signal })
    return parsePorcelainV2(result.stdout)
  }

  private async summary(repo: RegisteredRepo, signal?: AbortSignal): Promise<RepoSummary> {
    const [status, remotes] = await Promise.all([this.status(repo, signal), this.remoteRecords(repo, signal)])
    return summaryFromStatus({
      repoId: repo.repoId,
      name: repo.name,
      relativePath: repo.relativePath,
      remoteCount: remotes.length,
      status,
    })
  }

  private async history(repo: RegisteredRepo, limit: number, signal?: AbortSignal): Promise<CommitRow[]> {
    const format = '%H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D%x00'
    const result = await runGit(['log', `--max-count=${String(limit)}`, `--format=${format}`], {
      cwd: repo.path,
      signal,
      allowFailure: true,
      outputLimit: 4 * 1024 * 1024,
    })
    if (result.exitCode !== 0) return []
    return result.stdout.toString('utf8').split('\0').map(record => record.replace(/^\r?\n/, '')).filter(Boolean).map(record => {
      const [hash = '', shortHash = '', parents = '', author = '', authoredAt = '', subject = '', refs = ''] = record.split('\x1f')
      return {
        hash,
        shortHash,
        parents: parents === '' ? [] : parents.split(' '),
        author,
        authoredAt,
        subject,
        refs: refs === '' ? [] : refs.split(', ').map(item => item.trim()).filter(Boolean),
      }
    })
  }

  private async remoteRecords(repo: RegisteredRepo, signal?: AbortSignal): Promise<Array<{ name: string; fetchUrl: string; pushUrls: string[] }>> {
    const output = await gitText(['remote'], { cwd: repo.path, signal })
    const names = output.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    const records = []
    for (const name of names) {
      const fetchUrl = (await gitText(['remote', 'get-url', name], { cwd: repo.path, signal })).trim()
      const push = await runGit(['remote', 'get-url', '--all', '--push', name], { cwd: repo.path, signal, allowFailure: true })
      const pushUrls = push.exitCode === 0
        ? push.stdout.toString('utf8').split(/\r?\n/).map(value => value.trim()).filter(Boolean)
        : [fetchUrl]
      records.push({ name, fetchUrl, pushUrls })
    }
    return records
  }

  private async remotesFor(repo: RegisteredRepo, signal?: AbortSignal): Promise<RemoteView[]> {
    const settings = this.options.networkSettings()
    return (await this.remoteRecords(repo, signal)).map(remote => ({
      ...remote,
      fetchDecision: decideProxy(remote.fetchUrl, settings),
      pushDecisions: remote.pushUrls.map(url => decideProxy(url, settings)),
    }))
  }

  private async requireRemote(repo: RegisteredRepo, name: string, signal?: AbortSignal) {
    const remote = (await this.remoteRecords(repo, signal)).find(item => item.name === name)
    if (remote === undefined) throw new GitWorkspaceError('UNKNOWN_REMOTE', `Remote “${name}” 不存在。`)
    return remote
  }

  private async validateChangedPaths(repo: RegisteredRepo, paths: string[], signal?: AbortSignal): Promise<string[]> {
    if (paths.length === 0 || paths.length > 1000) throw new GitWorkspaceError('INVALID_PATHS', '请选择 1 到 1000 个文件。')
    const status = await this.status(repo, signal)
    const allowed = new Set(status.changes.flatMap(change => [change.path, ...(change.originalPath === undefined ? [] : [change.originalPath])]))
    const selected = [...new Set(paths)]
    if (!selected.every(path => typeof path === 'string' && path !== '' && !path.includes('\0') && allowed.has(path))) {
      throw new GitWorkspaceError('INVALID_PATH', '所选文件不在当前 Git 状态中，请刷新后重试。')
    }
    return selected
  }
}
