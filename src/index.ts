import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
import { registerTransport } from './host/transport.ts'
import { asError, GitWorkspaceError } from './host/errors.ts'
import { RepositoryService } from './host/repository-service.ts'
import { RPC, type NetworkSettings } from './shared/protocol.ts'

export const name = 'git-workspace'
export const inject = ['connection', 'workspaceRegistry', 'settings']
export const SETTINGS_NAMESPACE = 'dsh-git-workspace'

export interface Config extends NetworkSettings {
  enabled?: boolean
  scanDepth?: number
  ignoredDirectories?: string[]
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  scanDepth: z.number().min(0).max(12).default(4),
  ignoredDirectories: z.array(z.string()).default([]),
  proxyUrl: z.string().role('secret'),
  proxyHosts: z.array(z.string()).default([]),
  directHosts: z.array(z.string()).default([]),
  blockHosts: z.array(z.string()).default([]),
  defaultAction: z.union(['inherit', 'direct', 'block'] as const).default('inherit'),
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

function configValue(config: Config | undefined): Required<Pick<Config, 'enabled' | 'scanDepth' | 'ignoredDirectories' | 'proxyHosts' | 'directHosts' | 'blockHosts' | 'defaultAction'>> & Config {
  return {
    enabled: config?.enabled ?? true,
    scanDepth: config?.scanDepth ?? 4,
    ignoredDirectories: config?.ignoredDirectories ?? [],
    proxyHosts: config?.proxyHosts ?? [],
    directHosts: config?.directHosts ?? [],
    blockHosts: config?.blockHosts ?? [],
    defaultAction: config?.defaultAction ?? 'inherit',
    ...(config?.proxyUrl === undefined ? {} : { proxyUrl: config.proxyUrl }),
  }
}

export function apply(ctx: Context, entryConfig?: Config): void {
  const entry = configValue(entryConfig)
  const scope = ctx.settings.register(SETTINGS_NAMESPACE, Config, { base: entry, applies: 'live' })
  const source = (): Config => scope.get()
  const service = new RepositoryService(ctx.workspaceRegistry, {
    scanDepth: () => configValue(source()).scanDepth,
    ignoredDirectories: () => configValue(source()).ignoredDirectories,
    networkSettings: () => configValue(source()),
  })
  registerTransport(
    ctx.connection,
    async (endpoint, payload, signal): Promise<ConnectionRpcResult<unknown>> => {
      try {
        if (!configValue(source()).enabled) throw new GitWorkspaceError('DISABLED', 'Git 工作台已在 DSH Settings 中停用。')
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
