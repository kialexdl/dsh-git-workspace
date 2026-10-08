import type { Context, Volatile } from '@deepseek-ai/cordis'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
import { registerTransport } from './host/transport.ts'
import { asError, GitWorkspaceError } from './host/errors.ts'
import { RepositoryService } from './host/repository-service.ts'
import { RPC, type NetworkSettings } from './shared/protocol.ts'

export const name = 'git-workspace'
export const inject = ['connection', 'workspaceRegistry']
export const SETTINGS_NAMESPACE = 'dsh-git-workspace'

/** DSH 0.2.1 exposes editable fields through volatile plugin Config references. */
export interface Config {
  enabled: Volatile<boolean>
  scanDepth: Volatile<number>
  ignoredDirectories: Volatile<string[]>
  proxyUrl: Volatile<string | undefined>
  proxyHosts: Volatile<string[]>
  directHosts: Volatile<string[]>
  blockHosts: Volatile<string[]>
  defaultAction: Volatile<NonNullable<NetworkSettings['defaultAction']>>
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true).volatile(),
  scanDepth: z.number().min(0).max(12).default(4).volatile(),
  ignoredDirectories: z.array(z.string()).default([]).volatile(),
  proxyUrl: z.string().role('secret').volatile(),
  proxyHosts: z.array(z.string()).default([]).volatile(),
  directHosts: z.array(z.string()).default([]).volatile(),
  blockHosts: z.array(z.string()).default([]).volatile(),
  defaultAction: z.union(['inherit', 'direct', 'block'] as const).default('inherit').volatile(),
})

function stringField(payload: unknown, name: string): string {
  const value = (payload as Record<string, unknown> | null)?.[name]
  if (typeof value !== 'string' || value.trim() === '') throw new GitWorkspaceError('INVALID_REQUEST', `${name} is required`)
  return value
}

function stringArray(payload: unknown, name: string): string[] {
  const value = (payload as Record<string, unknown> | null)?.[name]
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new GitWorkspaceError('INVALID_REQUEST', `${name} must be a string array`)
  }
  return value
}

function optionalString(payload: unknown, name: string): string | undefined {
  const value = (payload as Record<string, unknown> | null)?.[name]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') throw new GitWorkspaceError('INVALID_REQUEST', `${name} must be a non-empty string`)
  return value
}

function booleanField(payload: unknown, name: string): boolean {
  const value = (payload as Record<string, unknown> | null)?.[name]
  if (typeof value !== 'boolean') throw new GitWorkspaceError('INVALID_REQUEST', `${name} must be boolean`)
  return value
}

function optionalBoolean(payload: unknown, name: string, fallback: boolean): boolean {
  const value = (payload as Record<string, unknown> | null)?.[name]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new GitWorkspaceError('INVALID_REQUEST', `${name} must be boolean`)
  return value
}

/**
 * Read one consistent configuration snapshot per operation. The browser edits
 * volatile references; the service never caches their initial values.
 */
export function configValue(config: Config): Required<Pick<NetworkSettings, 'proxyHosts' | 'directHosts' | 'blockHosts' | 'defaultAction'>> & NetworkSettings & {
  enabled: boolean
  scanDepth: number
  ignoredDirectories: string[]
} {
  return {
    enabled: config.enabled.get(),
    scanDepth: config.scanDepth.get(),
    ignoredDirectories: config.ignoredDirectories.get(),
    proxyUrl: config.proxyUrl.get(),
    proxyHosts: config.proxyHosts.get(),
    directHosts: config.directHosts.get(),
    blockHosts: config.blockHosts.get(),
    defaultAction: config.defaultAction.get(),
  }
}

export function apply(ctx: Context, entryConfig: Config): void {
  // The DSH Settings 0.2.x service no longer has settings.register().
  // The Loader now owns the effective Config and resolves volatile values.
  const source = () => configValue(entryConfig)
  const service = new RepositoryService(ctx.workspaceRegistry, {
    scanDepth: () => source().scanDepth,
    ignoredDirectories: () => source().ignoredDirectories,
    networkSettings: source,
  })
  registerTransport(
    ctx.connection,
    async (endpoint, payload, signal): Promise<ConnectionRpcResult<unknown>> => {
      try {
        if (!source().enabled) throw new GitWorkspaceError('DISABLED', 'Git 工作台已在 DSH 插件配置中停用。')
        const value = await dispatch(service, endpoint, payload, signal)
        return { ok: true, value }
      } catch (error) {
        const known = asError(error)
        return { ok: false, error: { code: 'internal', message: known.message, details: { ...known.details, pluginCode: known.code } } }
      }
    },
  )
}

export async function dispatch(service: RepositoryService, endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> {
  if (endpoint === RPC.workspaces) return service.listWorkspaces()
  const workspaceId = stringField(payload, 'workspaceId')
  if (endpoint === RPC.scan) return service.scan(workspaceId, signal)
  if (endpoint === RPC.batch) {
    const action = stringField(payload, 'action')
    if (action !== 'fetch' && action !== 'pull' && action !== 'push') throw new GitWorkspaceError('INVALID_REQUEST', 'invalid batch action')
    return service.batch(workspaceId, stringArray(payload, 'repoIds'), action, signal)
  }
  const repoId = stringField(payload, 'repoId')
  switch (endpoint) {
    case RPC.detail:
      return service.detail(workspaceId, repoId, signal)
    case RPC.diff:
      return service.diff(workspaceId, repoId, stringField(payload, 'path'), booleanField(payload, 'staged'), signal)
    case RPC.stage:
      return service.stage(workspaceId, repoId, stringArray(payload, 'paths'), signal)
    case RPC.unstage:
      return service.unstage(workspaceId, repoId, stringArray(payload, 'paths'), signal)
    case RPC.commit:
      return service.commit(workspaceId, repoId, stringField(payload, 'message'), signal)
    case RPC.commitDetail:
      return service.commitDetail(workspaceId, repoId, stringField(payload, 'hash'), signal)
    case RPC.commitDiff:
      return service.commitDiff(workspaceId, repoId, stringField(payload, 'hash'), stringField(payload, 'path'), signal)
    case RPC.branches:
      return service.branches(workspaceId, repoId, signal)
    case RPC.checkout:
      return service.checkout(workspaceId, repoId, stringField(payload, 'branch'), optionalBoolean(payload, 'remote', false), signal)
    case RPC.createBranch:
      return service.createBranch(workspaceId, repoId, stringField(payload, 'branch'), signal)
    case RPC.deleteBranch:
      return service.deleteBranch(workspaceId, repoId, stringField(payload, 'branch'), signal)
    case RPC.remotes:
      return service.remotes(workspaceId, repoId, signal)
    case RPC.addRemote:
      return service.addRemote(workspaceId, repoId, stringField(payload, 'name'), stringField(payload, 'url'), signal)
    case RPC.setRemoteUrl:
      return service.setRemoteUrl(workspaceId, repoId, stringField(payload, 'name'), stringField(payload, 'url'), booleanField(payload, 'push'), signal)
    case RPC.removeRemote:
      return service.removeRemote(workspaceId, repoId, stringField(payload, 'name'), signal)
    case RPC.fetch:
      return service.fetch(workspaceId, repoId, optionalString(payload, 'remote'), signal)
    case RPC.pull:
      return service.pull(workspaceId, repoId, optionalString(payload, 'remote'), signal)
    case RPC.push:
      return service.push(workspaceId, repoId, optionalString(payload, 'remote'), signal)
    case RPC.publish:
      return service.publish(workspaceId, repoId, stringField(payload, 'remote'), signal)
    default:
      throw new GitWorkspaceError('UNKNOWN_ENDPOINT', `Unknown endpoint: ${endpoint}`)
  }
}
