import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { GitWorkspaceError } from '../src/host/errors.ts'
import { RepositoryService, type WorkspaceRegistryFace } from '../src/host/repository-service.ts'

const roots: string[] = []

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

async function initRepo(path: string, committed: boolean): Promise<void> {
  await mkdir(path, { recursive: true })
  git(path, 'init', '-b', 'main')
  git(path, 'config', 'user.name', 'Test User')
  git(path, 'config', 'user.email', 'test@example.com')
  await writeFile(join(path, 'README.md'), '# repo\n')
  if (committed) {
    git(path, 'add', 'README.md')
    git(path, 'commit', '-m', 'initial')
  }
}

function service(root: string): RepositoryService {
  const workspace = { id: 'ws-1', path: root, title: 'Workspace' }
  const registry: WorkspaceRegistryFace = {
    list: () => [workspace],
    get: id => String(id) === 'ws-1' ? workspace : undefined,
  }
  return new RepositoryService(registry, {
    scanDepth: () => 4,
    ignoredDirectories: () => [],
    networkSettings: () => ({ defaultAction: 'inherit' }),
  })
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('RepositoryService integration', () => {
  it('discovers independent repositories and commits staged content only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dgw-test-'))
    roots.push(root)
    await initRepo(join(root, 'repo-a'), true)
    await initRepo(join(root, 'group', 'repo-b'), false)
    const target = service(root)
    const scan = await target.scan('ws-1')
    expect(scan.repositories.map(repo => repo.relativePath)).toEqual(['group/repo-b', 'repo-a'])

    const repoA = scan.repositories.find(repo => repo.name === 'repo-a')!
    await writeFile(join(root, 'repo-a', 'README.md'), '# changed\n')
    let detail = await target.detail('ws-1', repoA.repoId)
    expect(detail.summary).toMatchObject({ staged: 0, unstaged: 1 })

    await expect(target.commit('ws-1', repoA.repoId, 'must not auto-stage'))
      .rejects.toMatchObject({ code: 'NOTHING_STAGED' } satisfies Partial<GitWorkspaceError>)
    detail = await target.stage('ws-1', repoA.repoId, ['README.md'])
    expect(detail.summary).toMatchObject({ staged: 1, unstaged: 0 })
    detail = await target.commit('ws-1', repoA.repoId, 'docs: update readme')
    expect(detail.summary.clean).toBe(true)
    expect(detail.commits[0]?.subject).toBe('docs: update readme')
  })

  it('can unstage files in an unborn repository and rejects stale paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dgw-test-'))
    roots.push(root)
    await initRepo(join(root, 'repo'), false)
    const target = service(root)
    const repo = (await target.scan('ws-1')).repositories[0]!
    const untrackedDiff = await target.diff('ws-1', repo.repoId, 'README.md', false)
    expect(untrackedDiff).toContain('new file mode 100644')
    expect(untrackedDiff).toContain('+# repo')
    expect((await target.stage('ws-1', repo.repoId, ['README.md'])).summary.staged).toBe(1)
    expect((await target.unstage('ws-1', repo.repoId, ['README.md'])).summary.staged).toBe(0)
    await expect(target.stage('ws-1', repo.repoId, ['not-in-status.txt']))
      .rejects.toMatchObject({ code: 'INVALID_PATH' } satisfies Partial<GitWorkspaceError>)
  })

  it('lists and switches existing branches with non-empty names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dgw-test-'))
    roots.push(root)
    const repoPath = join(root, 'repo')
    await initRepo(repoPath, true)
    git(repoPath, 'branch', 'feature/existing')
    const target = service(root)
    const repo = (await target.scan('ws-1')).repositories[0]!

    const branches = await target.branches('ws-1', repo.repoId)
    expect(branches.map(branch => branch.name)).toEqual(['main', 'feature/existing'])
    expect(branches.find(branch => branch.name === 'main')).toMatchObject({ current: true, remote: false })
    expect((await target.checkout('ws-1', repo.repoId, 'feature/existing')).summary.branch).toBe('feature/existing')
  })

  it('discovers remote branches and creates a local tracking branch when selected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dgw-test-'))
    roots.push(root)
    const repoPath = join(root, 'repo')
    const remotePath = join(root, 'remote.git')
    await initRepo(repoPath, true)
    git(root, 'init', '--bare', 'remote.git')
    git(remotePath, 'symbolic-ref', 'HEAD', 'refs/heads/main')
    git(repoPath, 'remote', 'add', 'origin', remotePath)
    git(repoPath, 'push', '-u', 'origin', 'main')
    git(repoPath, 'switch', '-c', 'remote-only')
    await writeFile(join(repoPath, 'remote.txt'), 'remote branch\n')
    git(repoPath, 'add', 'remote.txt')
    git(repoPath, 'commit', '-m', 'feat: remote branch')
    git(repoPath, 'push', '-u', 'origin', 'remote-only')
    git(repoPath, 'switch', 'main')
    git(repoPath, 'branch', '-D', 'remote-only')
    git(repoPath, 'remote', 'set-head', 'origin', '-a')

    const target = service(root)
    const repo = (await target.scan('ws-1')).repositories[0]!
    const branches = await target.branches('ws-1', repo.repoId)
    expect(branches).toContainEqual(expect.objectContaining({
      name: 'origin/remote-only', remote: true, remoteName: 'origin', localName: 'remote-only',
    }))
    expect(branches.some(branch => branch.name === 'origin/HEAD')).toBe(false)

    const next = await target.checkout('ws-1', repo.repoId, 'origin/remote-only', true)
    expect(next.summary).toMatchObject({ branch: 'remote-only', upstream: 'origin/remote-only' })
  })

  it('returns full commit metadata and changed files for history details', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dgw-test-'))
    roots.push(root)
    const repoPath = join(root, 'repo')
    await initRepo(repoPath, true)
    await writeFile(join(repoPath, 'feature.txt'), 'detail\n')
    git(repoPath, 'add', 'feature.txt')
    git(repoPath, 'commit', '-m', 'feat: add detail')
    const target = service(root)
    const repo = (await target.scan('ws-1')).repositories[0]!
    const rows = (await target.detail('ws-1', repo.repoId)).commits
    const row = rows[0]!

    const commit = await target.commitDetail('ws-1', repo.repoId, row.hash)
    expect(commit).toMatchObject({ hash: row.hash, message: 'feat: add detail', author: 'Test User' })
    expect(commit.files).toContainEqual({ status: 'A', path: 'feature.txt' })
    const fileDiff = await target.commitDiff('ws-1', repo.repoId, row.hash, 'feature.txt')
    expect(fileDiff).toContain('+++ b/feature.txt')
    expect(fileDiff).toContain('+detail')
    await expect(target.commitDiff('ws-1', repo.repoId, row.hash, 'README.md'))
      .rejects.toMatchObject({ code: 'PATH_NOT_IN_COMMIT' } satisfies Partial<GitWorkspaceError>)
    const older = await target.commitDetail('ws-1', repo.repoId, rows[1]!.hash)
    expect(older).toMatchObject({ hash: rows[1]!.hash, message: 'initial', author: 'Test User' })
  })
})


describe('Pull preserves local changes', () => {
  async function setup() {
    const root = await mkdtemp(join(tmpdir(), 'dgw-pull-'))
    roots.push(root)
    const remote = join(root, 'remote.git')
    const publisher = join(root, 'publisher')
    const workspace = join(root, 'workspace')
    const local = join(workspace, 'local')
    await mkdir(workspace)
    git(root, 'init', '--bare', remote)
    await initRepo(publisher, true)
    git(publisher, 'remote', 'add', 'origin', remote)
    git(publisher, 'push', '-u', 'origin', 'main')
    git(workspace, 'clone', '-b', 'main', remote, local)
    git(local, 'config', 'user.name', 'Test User')
    git(local, 'config', 'user.email', 'test@example.com')
    // User settings must not make the plugin stash or rebase implicitly.
    git(local, 'config', 'pull.rebase', 'true')
    git(local, 'config', 'merge.autoStash', 'true')
    git(local, 'config', 'rebase.autoStash', 'true')
    const target = service(workspace)
    const repo = (await target.scan('ws-1')).repositories[0]!
    const publish = async (path: string, content: string) => {
      await writeFile(join(publisher, path), content)
      git(publisher, 'add', path)
      git(publisher, 'commit', '-m', 'remote change')
      git(publisher, 'push')
    }
    return { target, repo, local, publish }
  }

  it.each(['unstaged', 'staged', 'untracked'] as const)('fast-forwards with unrelated %s changes', async mode => {
    const { target, repo, local, publish } = await setup()
    const path = mode === 'untracked' ? 'local.txt' : 'README.md'
    await writeFile(join(local, path), 'local work\n')
    if (mode === 'staged') git(local, 'add', path)
    const before = git(local, 'status', '--porcelain')
    await publish('remote.txt', 'remote work\n')
    const result = await target.pull('ws-1', repo.repoId)
    expect(result.summary.behind).toBe(0)
    expect(await readFile(join(local, path), 'utf8')).toBe('local work\n')
    expect(await readFile(join(local, 'remote.txt'), 'utf8')).toBe('remote work\n')
    expect(git(local, 'status', '--porcelain')).toBe(before)
    expect(git(local, 'stash', 'list')).toBe('')
  })

  it.each(['tracked', 'untracked'] as const)('refuses an incoming change that would overwrite a %s file', async mode => {
    const { target, repo, local, publish } = await setup()
    const path = mode === 'tracked' ? 'README.md' : 'collision.txt'
    await writeFile(join(local, path), 'local work\n')
    const head = git(local, 'rev-parse', 'HEAD')
    const status = git(local, 'status', '--porcelain')
    await publish(path, 'remote work\n')
    await expect(target.pull('ws-1', repo.repoId)).rejects.toMatchObject({ code: 'GIT_FAILED' })
    expect(git(local, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(local, 'status', '--porcelain')).toBe(status)
    expect(await readFile(join(local, path), 'utf8')).toBe('local work\n')
    expect(git(local, 'stash', 'list')).toBe('')
  })

  it('refuses divergent history without merge or rebase', async () => {
    const { target, repo, local, publish } = await setup()
    await writeFile(join(local, 'local.txt'), 'local commit\n')
    git(local, 'add', 'local.txt')
    git(local, 'commit', '-m', 'local change')
    const head = git(local, 'rev-parse', 'HEAD')
    await publish('remote.txt', 'remote commit\n')
    await expect(target.pull('ws-1', repo.repoId)).rejects.toMatchObject({ code: 'GIT_FAILED' })
    expect(git(local, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(local, 'status', '--porcelain')).toBe('')
  })
})
