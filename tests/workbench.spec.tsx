// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Workbench } from '../src/client/Workbench.tsx'
import type { GitWorkspaceApi } from '../src/client/api.ts'
import { PanelController } from '../src/client/panel-controller.ts'
import type { RepositoryDetail, WorkspaceSnapshot } from '../src/shared/protocol.ts'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const summary = {
  repoId: 'repo-1',
  name: 'repo-one',
  relativePath: 'repo-one',
  branch: 'main',
  detached: false,
  head: '1111111111111111111111111111111111111111',
  ahead: 0,
  behind: 0,
  staged: 0,
  unstaged: 1,
  conflicts: 0,
  clean: false,
  remoteCount: 1,
}

const snapshot: WorkspaceSnapshot = {
  workspace: { workspaceId: 'ws-1', title: 'Workspace', path: '/workspace' },
  repositories: [summary, { ...summary, repoId: 'repo-2', name: 'repo-two', relativePath: 'repo-two' }],
  scannedAt: new Date(0).toISOString(),
}

const detail: RepositoryDetail = {
  summary,
  changes: [{
    path: 'new-file.txt',
    indexStatus: '.',
    worktreeStatus: '?',
    kind: 'untracked',
    staged: false,
    unstaged: true,
    conflict: false,
  }],
  commits: [{
    hash: '1111111111111111111111111111111111111111',
    shortHash: '1111111',
    parents: [],
    author: 'Test User',
    authoredAt: '2026-08-31T00:00:00Z',
    subject: 'feat: initial',
    refs: ['HEAD -> main'],
  }],
  remotes: [{
    name: 'origin',
    fetchUrl: 'https://github.com/example/repository-with-a-very-long-name.git',
    pushUrls: ['https://github.com/example/repository-with-a-very-long-name.git'],
    fetchDecision: { action: 'inherit', source: 'defaultAction', host: 'github.com', reason: '继承 Host 环境' },
    pushDecisions: [{ action: 'inherit', source: 'defaultAction', host: 'github.com', reason: '继承 Host 环境' }],
  }],
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(text))
  if (found === undefined) throw new Error(`button not found: ${text}`)
  return found
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

describe('Workbench interactions', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let api: GitWorkspaceApi
  let controller: PanelController

  beforeEach(async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    controller = new PanelController()
    api = {
      workspaces: vi.fn().mockResolvedValue([snapshot.workspace]),
      scan: vi.fn().mockResolvedValue(snapshot),
      detail: vi.fn().mockImplementation(async (_workspaceId: string, repoId: string) => ({
        ...detail,
        summary: snapshot.repositories.find(repo => repo.repoId === repoId) ?? summary,
      })),
      diff: vi.fn().mockResolvedValue('new file mode 100644\n@@ -0,0 +1,1 @@\n+hello\n'),
      branches: vi.fn().mockResolvedValue([
        { name: 'main', current: true, remote: false, ahead: 0, behind: 0 },
        { name: 'feature/existing', current: false, remote: false, ahead: 0, behind: 0 },
        { name: 'origin/remote-only', current: false, remote: true, remoteName: 'origin', localName: 'remote-only', ahead: 0, behind: 0 },
      ]),
      checkout: vi.fn().mockResolvedValue(detail),
      network: vi.fn().mockResolvedValue(detail),
      commitDetail: vi.fn().mockResolvedValue({
        hash: detail.commits[0]!.hash,
        parents: [],
        author: 'Test User',
        authoredAt: detail.commits[0]!.authoredAt,
        message: 'feat: initial\n\nFull body',
        files: [{ status: 'A', path: 'new-file.txt' }],
      }),
      commitDiff: vi.fn().mockResolvedValue('new file mode 100644\n@@ -0,0 +1,1 @@\n+committed content\n'),
    } as unknown as GitWorkspaceApi
    await act(async () => { root.render(<Workbench api={api} controller={controller} />) })
    await settle()
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    container.remove()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('selects all repositories and then inverts the selection', async () => {
    await act(async () => { button(container, '全选').click() })
    expect([...container.querySelectorAll<HTMLInputElement>('.dgw-repo input')].every(input => input.checked)).toBe(true)
    await act(async () => { button(container, '反选').click() })
    expect([...container.querySelectorAll<HTMLInputElement>('.dgw-repo input')].every(input => !input.checked)).toBe(true)
  })

  it('shows named existing branches in an explicit selector', async () => {
    await act(async () => { button(container, '分支').click() })
    await settle()
    const options = [...container.querySelectorAll<HTMLOptionElement>('#dgw-branch-target option')]
    expect(options.map(option => option.value)).toEqual(['local:main', 'local:feature/existing', 'remote:origin/remote-only'])
    expect(options.every(option => option.textContent?.trim() !== '')).toBe(true)
  })

  it('creates a local tracking branch when switching to a remote branch', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { button(container, '分支').click() })
    await settle()
    const select = container.querySelector<HTMLSelectElement>('#dgw-branch-target')!
    await act(async () => {
      select.value = 'remote:origin/remote-only'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { button(container, '切换').click() })
    await settle()
    expect(api.checkout).toHaveBeenCalledWith('ws-1', 'repo-1', 'origin/remote-only', true)
  })

  it('renders an untracked file as a numbered, colored addition', async () => {
    await act(async () => { button(container, 'new-file.txt').click() })
    await settle()
    expect(container.querySelector('.dgw-diff-line.addition code')?.textContent).toBe('hello')
    expect(container.querySelector('.dgw-diff-line.addition .dgw-line-number:nth-child(2)')?.textContent).toBe('1')
  })

  it('opens full commit details from history', async () => {
    await act(async () => { button(container, '提交记录').click() })
    await act(async () => { button(container, 'feat: initial').click() })
    await settle()
    expect(container.querySelector('.dgw-commit-detail pre')?.textContent).toContain('Full body')
    expect(container.querySelector('.dgw-commit-detail li code')?.textContent).toBe('new-file.txt')
  })

  it('opens a changed file diff from commit details and returns to the commit', async () => {
    await act(async () => { button(container, '提交记录').click() })
    await act(async () => { button(container, 'feat: initial').click() })
    await settle()
    await act(async () => { button(container, '查看内容').click() })
    await settle()
    expect(api.commitDiff).toHaveBeenCalledWith('ws-1', 'repo-1', detail.commits[0]!.hash, 'new-file.txt')
    expect(container.querySelector('.dgw-diff-line.addition code')?.textContent).toBe('committed content')
    await act(async () => { button(container, '返回提交').click() })
    expect(container.querySelector('.dgw-commit-detail pre')?.textContent).toContain('Full body')
  })

  it('updates every repository row while a batch fetch is running', async () => {
    let finishFirst!: (value: RepositoryDetail) => void
    let failSecond!: (reason: Error) => void
    const first = new Promise<RepositoryDetail>(resolve => { finishFirst = resolve })
    const second = new Promise<RepositoryDetail>((_resolve, reject) => { failSecond = reject })
    vi.mocked(api.network).mockImplementationOnce(() => first).mockImplementationOnce(() => second)

    await act(async () => { button(container, '全选').click() })
    await act(async () => { button(container, '批量 Fetch').click() })
    await act(async () => { button(container, '执行可执行项').click() })
    expect(api.network).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.dgw-plan-list .running')?.textContent).toBe('执行中')

    await act(async () => { finishFirst(detail); await first })
    await settle()
    const rows = [...container.querySelectorAll<HTMLElement>('.dgw-plan-list>div')]
    expect(rows[0]?.querySelector('.success')?.textContent).toBe('成功')
    expect(rows[1]?.querySelector('.running')?.textContent).toBe('执行中')

    await act(async () => { failSecond(new Error('network failed')); try { await second } catch {} })
    await settle()
    expect(rows[1]?.querySelector('.failed')?.textContent).toBe('失败')
    expect(container.textContent).not.toContain('操作中心')
  })

  it('starts independent dirty repository pulls concurrently when no conflict is reported', async () => {
    const cleanRepositories = snapshot.repositories.map(repo => ({
      ...repo, clean: false, unstaged: 1, upstream: 'origin/main',
    }))
    vi.mocked(api.scan).mockResolvedValue({ ...snapshot, repositories: cleanRepositories })
    vi.mocked(api.detail).mockImplementation(async (_workspaceId: string, id: string) => ({
      ...detail,
      changes: [],
      summary: cleanRepositories.find(repo => repo.repoId === id)!,
    }))
    await act(async () => { button(container, '刷新工作区并扫描').click() })
    await settle()

    let finishFirst!: (value: RepositoryDetail) => void
    let finishSecond!: (value: RepositoryDetail) => void
    const first = new Promise<RepositoryDetail>(resolve => { finishFirst = resolve })
    const second = new Promise<RepositoryDetail>(resolve => { finishSecond = resolve })
    vi.mocked(api.network).mockImplementationOnce(() => first).mockImplementationOnce(() => second)
    await act(async () => { button(container, '全选').click() })
    await act(async () => { button(container, '批量 Pull').click() })
    expect(container.textContent).toContain('最多 4 个仓库并行')
    await act(async () => { button(container, '执行可执行项').click() })
    expect(api.network).toHaveBeenCalledTimes(2)

    await act(async () => {
      finishFirst({ ...detail, changes: [], summary: cleanRepositories[0]! })
      finishSecond({ ...detail, changes: [], summary: cleanRepositories[1]! })
      await Promise.all([first, second])
    })
    await settle()
    expect(container.querySelectorAll('.dgw-plan-list .success')).toHaveLength(2)
  })

  it('offers keyboard-accessible splitters for repository and diff widths', async () => {
    const repositorySplitter = container.querySelector<HTMLElement>('[aria-label="调整仓库列表宽度"]')!
    expect(repositorySplitter).not.toBeNull()
    await act(async () => { repositorySplitter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect((container.querySelector('.dgw-columns') as HTMLElement).style.getPropertyValue('--dgw-repo-width')).toBe('256px')

    await act(async () => { button(container, 'new-file.txt').click() })
    await settle()
    expect(container.querySelector('[aria-label="调整详情查看区宽度"]')).not.toBeNull()
  })

  it('refreshes the workspace registry whenever the workbench is opened', async () => {
    const added = { workspaceId: 'ws-2', title: 'No-session workspace', path: '/workspace/new' }
    vi.mocked(api.workspaces).mockResolvedValue([snapshot.workspace, added])
    await act(async () => { controller.open() })
    await settle()
    expect([...container.querySelectorAll<HTMLSelectElement>('select[aria-label="Workspace"] option')].map(option => option.value))
      .toEqual(['ws-1', 'ws-2'])
  })
})
