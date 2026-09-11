import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {
  BatchResult,
  BranchView,
  CommitDetail,
  RepositoryDetail,
  WorkspaceSnapshot,
  WorkspaceView,
} from '../shared/protocol.ts'
import { RPC, RPC_CHANNEL, rpcMethod, type RpcEnvelope } from '../shared/protocol.ts'

export class GitWorkspaceApi {
  constructor(private readonly connection: ConnectionHandle) {}

  private async call<T>(endpoint: string, payload: unknown = {}, signal?: AbortSignal): Promise<T> {
    const answer = await this.connection.rpc.call(RPC_CHANNEL, rpcMethod(endpoint), payload, signal) as RpcEnvelope<T>
    if (!answer.ok) {
      const error = new Error(answer.error.message) as Error & { code?: string }
      error.code = answer.error.code
      throw error
    }
    return answer.value
  }

  workspaces(signal?: AbortSignal): Promise<WorkspaceView[]> {
    return this.call(RPC.workspaces, {}, signal)
  }

  scan(workspaceId: string, signal?: AbortSignal): Promise<WorkspaceSnapshot> {
    return this.call(RPC.scan, { workspaceId }, signal)
  }

  detail(workspaceId: string, repoId: string, signal?: AbortSignal): Promise<RepositoryDetail> {
    return this.call(RPC.detail, { workspaceId, repoId }, signal)
  }

  diff(workspaceId: string, repoId: string, path: string, staged: boolean, signal?: AbortSignal): Promise<string> {
    return this.call(RPC.diff, { workspaceId, repoId, path, staged }, signal)
  }

  stage(workspaceId: string, repoId: string, paths: string[], signal?: AbortSignal): Promise<RepositoryDetail> {
    return this.call(RPC.stage, { workspaceId, repoId, paths }, signal)
  }

  unstage(workspaceId: string, repoId: string, paths: string[], signal?: AbortSignal): Promise<RepositoryDetail> {
    return this.call(RPC.unstage, { workspaceId, repoId, paths }, signal)
  }

  commit(workspaceId: string, repoId: string, message: string, signal?: AbortSignal): Promise<RepositoryDetail> {
    return this.call(RPC.commit, { workspaceId, repoId, message }, signal)
  }

  commitDetail(workspaceId: string, repoId: string, hash: string, signal?: AbortSignal): Promise<CommitDetail> {
    return this.call(RPC.commitDetail, { workspaceId, repoId, hash }, signal)
  }

  commitDiff(workspaceId: string, repoId: string, hash: string, path: string, signal?: AbortSignal): Promise<string> {
    return this.call(RPC.commitDiff, { workspaceId, repoId, hash, path }, signal)
  }

  branches(workspaceId: string, repoId: string, signal?: AbortSignal): Promise<BranchView[]> {
    return this.call(RPC.branches, { workspaceId, repoId }, signal)
  }

  checkout(workspaceId: string, repoId: string, branch: string, remote = false, signal?: AbortSignal): Promise<RepositoryDetail> {
    return this.call(RPC.checkout, { workspaceId, repoId, branch, remote }, signal)
  }

  createBranch(workspaceId: string, repoId: string, branch: string): Promise<RepositoryDetail> {
    return this.call(RPC.createBranch, { workspaceId, repoId, branch })
  }

  deleteBranch(workspaceId: string, repoId: string, branch: string): Promise<RepositoryDetail> {
    return this.call(RPC.deleteBranch, { workspaceId, repoId, branch })
  }

  addRemote(workspaceId: string, repoId: string, name: string, url: string): Promise<RepositoryDetail> {
    return this.call(RPC.addRemote, { workspaceId, repoId, name, url })
  }

  setRemoteUrl(workspaceId: string, repoId: string, name: string, url: string, push: boolean): Promise<RepositoryDetail> {
    return this.call(RPC.setRemoteUrl, { workspaceId, repoId, name, url, push })
  }

  removeRemote(workspaceId: string, repoId: string, name: string): Promise<RepositoryDetail> {
    return this.call(RPC.removeRemote, { workspaceId, repoId, name })
  }

  network(action: 'fetch' | 'pull' | 'push', workspaceId: string, repoId: string, remote?: string, signal?: AbortSignal): Promise<RepositoryDetail> {
    return this.call(RPC[action], { workspaceId, repoId, ...(remote === undefined ? {} : { remote }) }, signal)
  }

  publish(workspaceId: string, repoId: string, remote: string): Promise<RepositoryDetail> {
    return this.call(RPC.publish, { workspaceId, repoId, remote })
  }

  batch(workspaceId: string, repoIds: string[], action: 'fetch' | 'pull' | 'push'): Promise<BatchResult> {
    return this.call(RPC.batch, { workspaceId, repoIds, action })
  }
}
