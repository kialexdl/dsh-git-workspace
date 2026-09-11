import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type {
  BranchView,
  CommitDetail,
  CommitFileChange,
  FileChange,
  RepositoryDetail,
  RepoSummary,
  WorkspaceSnapshot,
  WorkspaceView,
} from '../shared/protocol.ts'
import type { GitWorkspaceApi } from './api.ts'
import { CommitDetailView } from './CommitDetailView.tsx'
import { DiffViewer } from './DiffViewer.tsx'
import type { PanelController } from './panel-controller.ts'

type Tab = 'changes' | 'history' | 'remotes'
type BatchAction = 'fetch' | 'pull' | 'push'
type BatchStatus = 'blocked' | 'pending' | 'running' | 'success' | 'failed'

interface BatchProgress {
  status: BatchStatus
  message: string
}

const REPO_WIDTH_KEY = 'dsh-git-workspace:repo-width'
const DETAIL_WIDTH_KEY = 'dsh-git-workspace:detail-width'
const NETWORK_BATCH_CONCURRENCY = 4

function storedWidth(key: string, fallback: number): number {
  const value = Number(localStorage.getItem(key))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

function branchValue(branch: BranchView): string {
  return `${branch.remote ? 'remote' : 'local'}:${branch.name}`
}

function statusText(repo: RepoSummary): string {
  if (repo.conflicts > 0) return `${String(repo.conflicts)} 冲突`
  const parts = []
  if (repo.staged > 0) parts.push(`${String(repo.staged)} 已暂存`)
  if (repo.unstaged > 0) parts.push(`${String(repo.unstaged)} 修改`)
  if (repo.ahead > 0) parts.push(`↑${String(repo.ahead)}`)
  if (repo.behind > 0) parts.push(`↓${String(repo.behind)}`)
  return parts.join(' · ') || '干净'
}

function changeBadge(change: FileChange): string {
  if (change.conflict) return 'C'
  if (change.kind === 'untracked') return 'U'
  return change.indexStatus !== '.' ? change.indexStatus : change.worktreeStatus
}

export function Workbench({ api, controller }: { api: GitWorkspaceApi; controller: PanelController }) {
  const panel = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null)
  const [repoId, setRepoId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detail, setDetail] = useState<RepositoryDetail | null>(null)
  const [tab, setTab] = useState<Tab>('changes')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [diff, setDiff] = useState<{ path: string; text: string } | null>(null)
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null)
  const [branches, setBranches] = useState<BranchView[]>([])
  const [branchesOpen, setBranchesOpen] = useState(false)
  const [branchTarget, setBranchTarget] = useState('')
  const [pendingBatch, setPendingBatch] = useState<BatchAction | null>(null)
  const [batchProgress, setBatchProgress] = useState<Record<string, BatchProgress>>({})
  const [batchRunning, setBatchRunning] = useState(false)
  const [repoWidth, setRepoWidth] = useState(() => storedWidth(REPO_WIDTH_KEY, 240))
  const [detailWidth, setDetailWidth] = useState(() => storedWidth(DETAIL_WIDTH_KEY, 520))
  const columnsRef = useRef<HTMLElement>(null)
  const resizeRef = useRef<{ side: 'repos' | 'detail'; startX: number; startWidth: number } | null>(null)
  const current = snapshot?.repositories.find(repo => repo.repoId === repoId)
  const hasDetail = diff !== null || commitDetail !== null

  const fail = useCallback((value: unknown): void => {
    setError(value instanceof Error ? value.message : String(value))
  }, [])

  const loadDetail = useCallback(async (ws: string, repo: string): Promise<void> => {
    if (ws === '' || repo === '') return
    try {
      const next = await api.detail(ws, repo)
      setDetail(next)
      setSnapshot(previous => previous === null ? previous : ({
        ...previous,
        repositories: previous.repositories.map(item => item.repoId === repo ? next.summary : item),
      }))
    } catch (value) { fail(value) }
  }, [api, fail])

  const scan = useCallback(async (ws = workspaceId): Promise<void> => {
    if (ws === '') return
    setBusy('scan')
    setError('')
    try {
      const next = await api.scan(ws)
      setSnapshot(next)
      const nextRepo = next.repositories.some(repo => repo.repoId === repoId) ? repoId : (next.repositories[0]?.repoId ?? '')
      setRepoId(nextRepo)
      setSelected(previous => new Set([...previous].filter(id => next.repositories.some(repo => repo.repoId === id))))
      if (nextRepo !== '') await loadDetail(ws, nextRepo)
      else setDetail(null)
    } catch (value) { fail(value) } finally { setBusy('') }
  }, [api, fail, loadDetail, repoId, workspaceId])

  useEffect(() => {
    const abort = new AbortController()
    void api.workspaces(abort.signal).then(items => {
      setWorkspaces(items)
      const stored = localStorage.getItem('dsh-git-workspace:last-workspace')
      const next = items.some(item => item.workspaceId === stored) ? stored! : (items[0]?.workspaceId ?? '')
      setWorkspaceId(next)
      if (next !== '') void scan(next)
    }).catch(fail)
    return () => { abort.abort() }
  }, [api])

  useEffect(() => {
    if (!panel.open) return
    const abort = new AbortController()
    const refresh = (): void => {
      void api.workspaces(abort.signal).then(setWorkspaces).catch(value => {
        if (!abort.signal.aborted) fail(value)
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => {
      abort.abort()
      window.clearInterval(timer)
    }
  }, [api, fail, panel.open])

  useEffect(() => {
    if (workspaceId !== '') localStorage.setItem('dsh-git-workspace:last-workspace', workspaceId)
  }, [workspaceId])

  useEffect(() => { localStorage.setItem(REPO_WIDTH_KEY, String(repoWidth)) }, [repoWidth])
  useEffect(() => { localStorage.setItem(DETAIL_WIDTH_KEY, String(detailWidth)) }, [detailWidth])

  useEffect(() => {
    if (workspaceId === '' || repoId === '') return
    const timer = window.setInterval(() => { void loadDetail(workspaceId, repoId) }, 5000)
    return () => { window.clearInterval(timer) }
  }, [loadDetail, repoId, workspaceId])

  const runDetail = async (label: string, action: () => Promise<RepositoryDetail>): Promise<void> => {
    if (busy !== '') return
    setBusy(label)
    setError('')
    try {
      const next = await action()
      setDetail(next)
      setSnapshot(previous => previous === null ? previous : ({
        ...previous,
        repositories: previous.repositories.map(repo => repo.repoId === next.summary.repoId ? next.summary : repo),
      }))
    } catch (value) { fail(value) } finally { setBusy('') }
  }

  const chooseRepo = (id: string): void => {
    setRepoId(id)
    setDetail(null)
    setDiff(null)
    setCommitDetail(null)
    setBranches([])
    setBranchesOpen(false)
    setBranchTarget('')
    setError('')
    void loadDetail(workspaceId, id)
  }

  const toggleSelect = (id: string): void => {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = (): void => {
    setSelected(new Set((snapshot?.repositories ?? []).map(repo => repo.repoId)))
  }

  const invertSelection = (): void => {
    const repositories = snapshot?.repositories ?? []
    setSelected(previous => new Set(repositories.filter(repo => !previous.has(repo.repoId)).map(repo => repo.repoId)))
  }

  const openBranches = (): void => {
    if (branchesOpen) {
      setBranchesOpen(false)
      return
    }
    setBranchesOpen(true)
    void api.branches(workspaceId, repoId).then(items => {
      setBranches(items)
      const target = items.find(branch => branch.current) ?? items.find(branch => !branch.remote) ?? items[0]
      setBranchTarget(target === undefined ? '' : branchValue(target))
    }).catch(fail)
  }

  const showCommit = (hash: string): void => {
    if (busy !== '') return
    setBusy('commit-detail')
    setError('')
    setDiff(null)
    setCommitDetail(null)
    void api.commitDetail(workspaceId, repoId, hash)
      .then(setCommitDetail)
      .catch(fail)
      .finally(() => setBusy(''))
  }

  const showCommitFile = (file: CommitFileChange): void => {
    if (busy !== '' || commitDetail === null) return
    const commit = commitDetail
    setBusy('commit-diff')
    setError('')
    void api.commitDiff(workspaceId, repoId, commit.hash, file.path)
      .then(text => setDiff({ path: `${file.path} · ${commit.hash.slice(0, 12)}`, text }))
      .catch(fail)
      .finally(() => setBusy(''))
  }

  const network = (action: 'fetch' | 'pull' | 'push'): void => {
    if (detail === null) return
    if (!window.confirm(`确认对 ${detail.summary.name} 执行 ${action.toUpperCase()}？`)) return
    void runDetail(action, async () => {
      if (action === 'push' && detail.summary.upstream === undefined) {
        const remote = detail.remotes[0]?.name
        if (remote === undefined) throw new Error('没有可用于发布的 remote。')
        if (!window.confirm(`当前分支没有 upstream，是否发布到 ${remote}？`)) throw new Error('已取消发布。')
        return api.publish(workspaceId, repoId, remote)
      }
      return api.network(action, workspaceId, repoId)
    })
  }

  const preflight = (repo: RepoSummary, action: BatchAction): { executable: boolean; reason: string } => {
    if (repo.remoteCount === 0) return { executable: false, reason: '没有 remote' }
    if (action === 'pull' && repo.conflicts > 0) return { executable: false, reason: '存在未解决冲突' }
    if ((action === 'pull' || action === 'push') && repo.detached) return { executable: false, reason: 'Detached HEAD' }
    if (action === 'push' && repo.upstream === undefined) return { executable: false, reason: '分支未发布' }
    return { executable: true, reason: '执行时按 Remote URL 决定网络策略' }
  }

  const prepareBatch = (action: BatchAction): void => {
    const progress: Record<string, BatchProgress> = {}
    for (const repo of snapshot?.repositories ?? []) {
      if (!selected.has(repo.repoId)) continue
      const plan = preflight(repo, action)
      progress[repo.repoId] = plan.executable
        ? { status: 'pending', message: plan.reason }
        : { status: 'blocked', message: plan.reason }
    }
    setBatchProgress(progress)
    setPendingBatch(action)
  }

  const runBatch = async (action: BatchAction): Promise<void> => {
    const rows = (snapshot?.repositories ?? []).filter(repo => {
      const status = batchProgress[repo.repoId]?.status
      return status === 'pending' || status === 'failed'
    })
    if (rows.length === 0) return
    setBatchRunning(true)
    setBusy(`batch-${action}`)
    setError('')
    const runOne = async (repo: RepoSummary): Promise<void> => {
      setBatchProgress(previous => ({ ...previous, [repo.repoId]: { status: 'running', message: `${action.toUpperCase()} 执行中…` } }))
      try {
        const next = await api.network(action, workspaceId, repo.repoId)
        setSnapshot(previous => previous === null ? previous : ({
          ...previous,
          repositories: previous.repositories.map(item => item.repoId === repo.repoId ? next.summary : item),
        }))
        if (repo.repoId === repoId) setDetail(next)
        setBatchProgress(previous => ({ ...previous, [repo.repoId]: { status: 'success', message: `${action.toUpperCase()} 执行成功` } }))
      } catch (value) {
        const reason = value instanceof Error ? value.message : String(value)
        setBatchProgress(previous => ({ ...previous, [repo.repoId]: { status: 'failed', message: reason } }))
      }
    }
    if (action === 'push') {
      for (const repo of rows) await runOne(repo)
    } else {
      let cursor = 0
      const next = async (): Promise<void> => {
        while (cursor < rows.length) {
          const repo = rows[cursor++]
          if (repo !== undefined) await runOne(repo)
        }
      }
      await Promise.all(Array.from({ length: Math.min(NETWORK_BATCH_CONCURRENCY, rows.length) }, next))
    }
    setBusy('')
    setBatchRunning(false)
  }

  const closeBatch = (): void => {
    if (batchRunning) return
    setPendingBatch(null)
    setBatchProgress({})
  }

  const beginResize = (side: 'repos' | 'detail', event: ReactPointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeRef.current = { side, startX: event.clientX, startWidth: side === 'repos' ? repoWidth : detailWidth }
  }

  const resizeColumns = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current
    const width = columnsRef.current?.getBoundingClientRect().width ?? 0
    if (resize === null || width <= 0) return
    if (resize.side === 'repos') {
      const reserved = hasDetail ? detailWidth + 340 : 340
      setRepoWidth(clamp(resize.startWidth + event.clientX - resize.startX, 180, Math.min(480, width - reserved)))
    } else {
      setDetailWidth(clamp(resize.startWidth + resize.startX - event.clientX, 300, Math.min(960, width - repoWidth - 340)))
    }
  }

  const finishResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    resizeRef.current = null
  }

  const resizeByKeyboard = (side: 'repos' | 'detail', event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    if (side === 'repos') setRepoWidth(previous => clamp(previous + direction * 16, 180, 480))
    else setDetailWidth(previous => clamp(previous - direction * 16, 300, 960))
  }

  const staged = useMemo(() => detail?.changes.filter(change => change.staged) ?? [], [detail])
  const unstaged = useMemo(() => detail?.changes.filter(change => change.unstaged) ?? [], [detail])
  const localBranches = useMemo(() => branches.filter(branch => !branch.remote), [branches])
  const remoteBranches = useMemo(() => branches.filter(branch => branch.remote), [branches])
  const selectedBranch = branches.find(branch => branchValue(branch) === branchTarget)
  const batchRows = (snapshot?.repositories ?? []).filter(repo => batchProgress[repo.repoId] !== undefined)
  const batchFinished = batchRows.filter(repo => ['success', 'failed', 'blocked'].includes(batchProgress[repo.repoId]!.status)).length
  const batchFailed = batchRows.some(repo => batchProgress[repo.repoId]?.status === 'failed')
  const batchRunnable = batchRows.some(repo => ['pending', 'failed'].includes(batchProgress[repo.repoId]!.status))
  const columnStyle = {
    '--dgw-repo-width': `${String(repoWidth)}px`,
    '--dgw-detail-width': `${String(detailWidth)}px`,
  } as CSSProperties

  const fileRow = (change: FileChange, stageMode: boolean) => (
    <li className="dgw-file" key={`${stageMode ? 's' : 'u'}:${change.path}`}>
      <button className="dgw-file-main" type="button" onClick={() => {
        void api.diff(workspaceId, repoId, change.path, stageMode).then(text => {
          setCommitDetail(null)
          setDiff({ path: change.path, text })
        }).catch(fail)
      }}>
        <span className={`dgw-change dgw-${change.kind}`}>{changeBadge(change)}</span>
        <span className="dgw-file-path" title={change.path}>{change.path}</span>
      </button>
      <button
        className="dgw-icon-button"
        type="button"
        title={stageMode ? '取消暂存' : '暂存'}
        disabled={busy !== ''}
        onClick={() => { void runDetail(stageMode ? 'unstage' : 'stage', () => stageMode
          ? api.unstage(workspaceId, repoId, [change.path])
          : api.stage(workspaceId, repoId, [change.path])) }}
      >{stageMode ? '−' : '+'}</button>
    </li>
  )

  return (
    <div className="dgw-shell">
      <header className="dgw-topbar">
        <div>
          <strong>Git 工作台</strong>
          <span className="dgw-subtitle">当前 DSH workspace 内的独立仓库</span>
        </div>
        <div className="dgw-top-actions">
          <select aria-label="Workspace" value={workspaceId} onChange={event => {
            setWorkspaceId(event.target.value)
            setSnapshot(null)
            setRepoId('')
            setDetail(null)
            setDiff(null)
            setCommitDetail(null)
            setBranchesOpen(false)
            void scan(event.target.value)
          }}>
            {workspaces.map(workspace => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>)}
          </select>
          <button type="button" onClick={() => {
            void api.workspaces().then(items => {
              setWorkspaces(items)
              const target = items.some(item => item.workspaceId === workspaceId) ? workspaceId : (items[0]?.workspaceId ?? '')
              if (target !== workspaceId) setWorkspaceId(target)
              if (target !== '') void scan(target)
              else {
                setSnapshot(null)
                setRepoId('')
                setDetail(null)
              }
            }).catch(fail)
          }} disabled={busy !== ''}>刷新工作区并扫描</button>
          <button type="button" className="dgw-close" onClick={controller.close}>关闭并返回会话</button>
        </div>
      </header>

      {error !== '' && <div className="dgw-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')}>关闭</button></div>}

      <div className="dgw-batchbar">
        <span>已选择 {String(selected.size)} 个仓库</span>
        <button type="button" disabled={(snapshot?.repositories.length ?? 0) === 0 || busy !== ''} onClick={selectAll}>全选</button>
        <button type="button" disabled={(snapshot?.repositories.length ?? 0) === 0 || busy !== ''} onClick={invertSelection}>反选</button>
        <button type="button" disabled={selected.size === 0 || busy !== ''} onClick={() => prepareBatch('fetch')}>批量 Fetch</button>
        <button type="button" disabled={selected.size === 0 || busy !== ''} onClick={() => prepareBatch('pull')}>批量 Pull</button>
        <button type="button" disabled={selected.size === 0 || busy !== ''} onClick={() => prepareBatch('push')}>批量 Push</button>
      </div>

      <main ref={columnsRef} className={`dgw-columns${hasDetail ? ' has-detail' : ''}`} style={columnStyle}>
        <aside className="dgw-repos">
          <div className="dgw-section-head"><span>仓库</span><span>{String(snapshot?.repositories.length ?? 0)}</span></div>
          {snapshot?.repositories.length === 0 && <p className="dgw-empty">在扫描深度内没有发现 Git 仓库。</p>}
          <ul>
            {snapshot?.repositories.map(repo => (
              <li key={repo.repoId} className={repo.repoId === repoId ? 'dgw-repo active' : 'dgw-repo'}>
                <input type="checkbox" checked={selected.has(repo.repoId)} aria-label={`选择 ${repo.name}`} onChange={() => toggleSelect(repo.repoId)} />
                <button type="button" onClick={() => chooseRepo(repo.repoId)}>
                  <span className="dgw-repo-title"><strong>{repo.name}</strong><code>{repo.branch}</code></span>
                  <span className="dgw-repo-path">{repo.relativePath}</span>
                  <span className={repo.conflicts > 0 ? 'dgw-status danger' : 'dgw-status'}>{statusText(repo)}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div
          className="dgw-splitter dgw-splitter-repos"
          role="separator"
          tabIndex={0}
          aria-label="调整仓库列表宽度"
          aria-orientation="vertical"
          aria-valuenow={repoWidth}
          onPointerDown={event => beginResize('repos', event)}
          onPointerMove={resizeColumns}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onKeyDown={event => resizeByKeyboard('repos', event)}
        />

        <section className="dgw-main">
          {current === undefined || detail === null ? (
            <div className="dgw-placeholder">{busy === 'scan' ? '正在扫描仓库…' : '选择一个仓库查看修改、历史与 Remote。'}</div>
          ) : (
            <>
              <div className="dgw-repo-head">
                <div><strong>{detail.summary.name}</strong><span>{detail.summary.relativePath}</span></div>
                <div className="dgw-network-actions">
                  <button type="button" disabled={busy !== ''} onClick={() => network('fetch')}>Fetch</button>
                  <button type="button" disabled={busy !== ''} onClick={() => network('pull')}>Pull --ff-only</button>
                  <button type="button" disabled={busy !== ''} onClick={() => network('push')}>Push</button>
                  <button type="button" disabled={busy !== ''} onClick={openBranches}>分支</button>
                </div>
              </div>
              {branchesOpen && (
                <div className="dgw-branch-menu">
                  <div className="dgw-branch-switch">
                    <label htmlFor="dgw-branch-target">已有分支</label>
                    <select id="dgw-branch-target" value={branchTarget} disabled={branches.length === 0 || busy !== ''} onChange={event => setBranchTarget(event.target.value)}>
                      {branches.length === 0 && <option value="">尚无已有分支</option>}
                      {localBranches.length > 0 && <optgroup label="本地分支">{localBranches.map(branch => <option value={branchValue(branch)} key={branchValue(branch)}>{branch.current ? '● ' : ''}{branch.name}</option>)}</optgroup>}
                      {remoteBranches.length > 0 && <optgroup label="远程分支（切换时创建本地跟踪分支）">{remoteBranches.map(branch => <option value={branchValue(branch)} key={branchValue(branch)}>{branch.name}</option>)}</optgroup>}
                    </select>
                    <button type="button" disabled={selectedBranch === undefined || selectedBranch.current || busy !== ''} onClick={() => {
                      if (selectedBranch === undefined) return
                      const prompt = selectedBranch.remote
                        ? `从远程分支 ${selectedBranch.name} 创建本地跟踪分支 ${selectedBranch.localName ?? ''} 并切换？`
                        : `切换到本地分支 ${selectedBranch.name}？`
                      if (!window.confirm(prompt)) return
                      void runDetail('checkout', async () => {
                        const next = await api.checkout(workspaceId, repoId, selectedBranch.name, selectedBranch.remote)
                        const items = await api.branches(workspaceId, repoId)
                        setBranches(items)
                        const target = items.find(branch => branch.current)
                        setBranchTarget(target === undefined ? '' : branchValue(target))
                        return next
                      })
                    }}>切换</button>
                  </div>
                  <div className="dgw-branch-list">
                    {branches.map(branch => <span className="dgw-branch-item" key={branchValue(branch)}>
                      <span title={branch.name}>{branch.current ? '● ' : ''}{branch.name}{branch.remote ? ' · 远程' : ''}</span>
                      {!branch.remote && !branch.current && <button type="button" className="danger" title={`删除 ${branch.name}`} disabled={busy !== ''} onClick={() => {
                        if (!window.confirm(`只删除本地已合并分支 ${branch.name}，继续吗？`)) return
                        void runDetail('branch-delete', async () => {
                          const next = await api.deleteBranch(workspaceId, repoId, branch.name)
                          const items = await api.branches(workspaceId, repoId)
                          setBranches(items)
                          const target = items.find(item => item.current) ?? items.find(item => !item.remote) ?? items[0]
                          setBranchTarget(target === undefined ? '' : branchValue(target))
                          return next
                        })
                      }}>×</button>}
                    </span>)}
                  </div>
                  <button type="button" onClick={() => {
                    const name = window.prompt('新分支名称')
                    if (name !== null) void runDetail('branch', async () => {
                      const next = await api.createBranch(workspaceId, repoId, name)
                      const items = await api.branches(workspaceId, repoId)
                      setBranches(items)
                      const target = items.find(branch => branch.current)
                      setBranchTarget(target === undefined ? '' : branchValue(target))
                      return next
                    })
                  }}>+ 新分支</button>
                  <button type="button" onClick={() => setBranchesOpen(false)}>收起</button>
                </div>
              )}
              <nav className="dgw-tabs">
                {(['changes', 'history', 'remotes'] as const).map(item => <button type="button" key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item === 'changes' ? `修改 ${String(detail.changes.length)}` : item === 'history' ? '提交记录' : `Remotes ${String(detail.remotes.length)}`}</button>)}
              </nav>

              {tab === 'changes' && (
                <div className="dgw-changes">
                  <div className="dgw-commit-box">
                    <textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="提交信息（仅提交已暂存内容）" rows={3} />
                    <button type="button" disabled={message.trim() === '' || staged.length === 0 || busy !== ''} onClick={() => {
                      if (!window.confirm(`确认提交 ${String(staged.length)} 个已暂存文件？未暂存文件不会包含在提交中。`)) return
                      void runDetail('commit', async () => {
                        const next = await api.commit(workspaceId, repoId, message)
                        setMessage('')
                        return next
                      })
                    }}>提交 {staged.length > 0 ? `(${String(staged.length)})` : ''}</button>
                  </div>
                  <div className="dgw-change-list">
                    <div className="dgw-list-title"><span>已暂存</span>{staged.length > 0 && <button type="button" onClick={() => { void runDetail('unstage-all', () => api.unstage(workspaceId, repoId, staged.map(item => item.path))) }}>全部取消</button>}</div>
                    <ul>{staged.map(change => fileRow(change, true))}</ul>
                    <div className="dgw-list-title"><span>修改</span>{unstaged.length > 0 && <button type="button" onClick={() => { void runDetail('stage-all', () => api.stage(workspaceId, repoId, unstaged.map(item => item.path))) }}>全部暂存</button>}</div>
                    <ul>{unstaged.map(change => fileRow(change, false))}</ul>
                  </div>
                </div>
              )}

              {tab === 'history' && <ol className="dgw-history">{detail.commits.map(commit => <li key={commit.hash}><button type="button" disabled={busy !== ''} onClick={() => showCommit(commit.hash)}><code>{commit.shortHash}</code><div><strong>{commit.subject}</strong><span>{commit.author} · {new Date(commit.authoredAt).toLocaleString()}</span></div><span className="dgw-history-open">查看详情</span></button></li>)}</ol>}

              {tab === 'remotes' && <div className="dgw-remotes">
                {detail.remotes.map(remote => <article key={remote.name}>
                  <div className="dgw-remote-head"><strong>{remote.name}</strong><span>
                    <button type="button" onClick={() => {
                      const url = window.prompt(`修改 ${remote.name} 的 Fetch URL`, remote.fetchUrl)
                      if (url !== null) void runDetail('remote-update', () => api.setRemoteUrl(workspaceId, repoId, remote.name, url, false))
                    }}>修改</button>
                    <button type="button" onClick={() => {
                      if (window.confirm(`确认删除 remote ${remote.name}？`)) void runDetail('remote-remove', () => api.removeRemote(workspaceId, repoId, remote.name))
                    }}>删除</button>
                  </span></div>
                  <p className="dgw-remote-row"><span>Fetch</span><em className={`dgw-policy ${remote.fetchDecision.action}`}>{remote.fetchDecision.action}</em><code>{remote.fetchUrl}</code></p>
                  {remote.pushUrls.map((url, index) => <p className="dgw-remote-row" key={url}><span>Push</span><em className={`dgw-policy ${remote.pushDecisions[index]?.action ?? 'inherit'}`}>{remote.pushDecisions[index]?.action ?? 'inherit'}</em><code>{url}</code></p>)}
                  <small>{remote.fetchDecision.reason}</small>
                </article>)}
                <button type="button" onClick={() => {
                  const name = window.prompt('Remote 名称', 'origin')
                  if (name === null) return
                  const url = window.prompt('Remote URL')
                  if (url !== null) void runDetail('remote-add', () => api.addRemote(workspaceId, repoId, name, url))
                }}>+ 添加 Remote</button>
                <p className="dgw-hint">代理规则请在 DSH Settings → 插件配置 → Git 工作台网络中修改。</p>
              </div>}
            </>
          )}
        </section>

        {hasDetail && <>
          <div
            className="dgw-splitter dgw-splitter-detail"
            role="separator"
            tabIndex={0}
            aria-label="调整详情查看区宽度"
            aria-orientation="vertical"
            aria-valuenow={detailWidth}
            onPointerDown={event => beginResize('detail', event)}
            onPointerMove={resizeColumns}
            onPointerUp={finishResize}
            onPointerCancel={finishResize}
            onKeyDown={event => resizeByKeyboard('detail', event)}
          />
          <aside className="dgw-detail">
            <div className="dgw-section-head"><span>{diff !== null ? diff.path : `提交 ${commitDetail!.hash.slice(0, 12)}`}</span><button type="button" onClick={() => {
              if (diff !== null && commitDetail !== null) setDiff(null)
              else { setDiff(null); setCommitDetail(null) }
            }}>{diff !== null && commitDetail !== null ? '返回提交' : '关闭'}</button></div>
            {diff !== null ? <DiffViewer text={diff.text} /> : <CommitDetailView detail={commitDetail!} disabled={busy !== ''} onOpenFile={showCommitFile} />}
          </aside>
        </>}
      </main>
      {pendingBatch !== null && (
        <div className="dgw-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeBatch() }}>
          <section className="dgw-modal" role="dialog" aria-modal="true" aria-labelledby="dgw-batch-title">
            <header><div><strong id="dgw-batch-title">批量 {pendingBatch.toUpperCase()}</strong><span>{batchRunning ? `正在执行：${String(batchFinished)}/${String(batchRows.length)} 已完成` : `${String(batchFinished)}/${String(batchRows.length)} 已完成；${pendingBatch === 'push' ? '顺序执行' : `最多 ${String(NETWORK_BATCH_CONCURRENCY)} 个仓库并行`}`}</span></div><button type="button" disabled={batchRunning} onClick={closeBatch}>×</button></header>
            <div className="dgw-plan-list">
              {batchRows.map(repo => {
                const progress = batchProgress[repo.repoId]!
                const label: Record<BatchStatus, string> = { blocked: '已阻止', pending: '等待中', running: '执行中', success: '成功', failed: '失败' }
                return <div key={repo.repoId}><strong>{repo.name}</strong><code>{repo.branch}</code><small>{progress.message}</small><span className={progress.status}>{label[progress.status]}</span></div>
              })}
            </div>
            <footer><button type="button" disabled={batchRunning} onClick={closeBatch}>{batchFinished === batchRows.length ? '关闭' : '取消'}</button>{batchRunnable && <button className="primary" type="button" disabled={batchRunning} onClick={() => { void runBatch(pendingBatch) }}>{batchFailed ? '重试失败项' : '执行可执行项'}</button>}</footer>
          </section>
        </div>
      )}
    </div>
  )
}
