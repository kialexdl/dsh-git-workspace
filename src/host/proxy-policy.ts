import type { NetworkSettings, ProxyDecision } from '../shared/protocol.ts'
import { GitWorkspaceError } from './errors.ts'

const DEFAULT_SETTINGS: Required<Omit<NetworkSettings, 'proxyUrl'>> = {
  proxyHosts: [],
  directHosts: [],
  blockHosts: [],
  defaultAction: 'inherit',
}

export interface RemoteTarget {
  rawUrl: string
  protocol: string
  host?: string
}

export function remoteTarget(rawUrl: string): RemoteTarget {
  const value = rawUrl.trim()
  try {
    const parsed = new URL(value)
    return { rawUrl: value, protocol: parsed.protocol.replace(/:$/, '').toLowerCase(), host: parsed.hostname.toLowerCase() }
  } catch {
    const scp = /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(value)
    if (scp !== null && !/^[A-Za-z]:[\\/]/.test(value)) {
      return { rawUrl: value, protocol: 'ssh', host: scp[1]!.toLowerCase() }
    }
    return { rawUrl: value, protocol: 'file' }
  }
}

export function hostMatches(host: string, pattern: string): boolean {
  const candidate = host.trim().toLowerCase()
  const rule = pattern.trim().toLowerCase()
  if (candidate === '' || rule === '') return false
  const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i').test(candidate)
}

function matches(host: string | undefined, patterns: readonly string[]): boolean {
  return host !== undefined && patterns.some(pattern => hostMatches(host, pattern))
}

function safeEndpoint(proxyUrl: string | undefined): string | undefined {
  if (proxyUrl === undefined || proxyUrl.trim() === '') return undefined
  try {
    const parsed = new URL(proxyUrl)
    return `${parsed.protocol}//${parsed.hostname}${parsed.port === '' ? '' : `:${parsed.port}`}`
  } catch {
    return 'configured proxy'
  }
}

export function decideProxy(rawUrl: string, settings: NetworkSettings): ProxyDecision {
  const target = remoteTarget(rawUrl)
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  if (matches(target.host, merged.blockHosts)) {
    return { action: 'block', source: 'blockHosts', host: target.host, reason: '目标主机命中“禁止访问”列表。' }
  }
  if (matches(target.host, merged.directHosts)) {
    return { action: 'direct', source: 'directHosts', host: target.host, reason: '目标主机命中“强制直连”列表。' }
  }
  if (matches(target.host, merged.proxyHosts)) {
    if (target.protocol !== 'http' && target.protocol !== 'https') {
      return { action: 'block', source: 'unsupported', host: target.host, reason: `当前版本不为 ${target.protocol.toUpperCase()} remote 注入 HTTP 代理。` }
    }
    if (settings.proxyUrl === undefined || settings.proxyUrl.trim() === '') {
      return { action: 'block', source: 'proxyHosts', host: target.host, reason: '主机要求走代理，但 DSH Settings 中尚未配置代理地址。' }
    }
    return { action: 'proxy', source: 'proxyHosts', host: target.host, endpoint: safeEndpoint(settings.proxyUrl), reason: '目标主机命中“走代理”列表。' }
  }
  return {
    action: merged.defaultAction,
    source: 'defaultAction',
    host: target.host,
    reason: `未命中主机列表，使用默认动作 ${merged.defaultAction}。`,
  }
}

export interface NetworkExecution {
  gitConfigArgs: string[]
  env: Record<string, string | undefined>
  decision: ProxyDecision
}

export function networkExecution(rawUrl: string, settings: NetworkSettings): NetworkExecution {
  const decision = decideProxy(rawUrl, settings)
  if (decision.action === 'block') {
    throw new GitWorkspaceError('REMOTE_BLOCKED', decision.reason, { host: decision.host, source: decision.source })
  }
  if (decision.action === 'proxy') {
    return {
      decision,
      gitConfigArgs: [
        '--config-env=http.proxy=DSH_GIT_WORKSPACE_PROXY',
        '--config-env=https.proxy=DSH_GIT_WORKSPACE_PROXY',
      ],
      env: { DSH_GIT_WORKSPACE_PROXY: settings.proxyUrl },
    }
  }
  if (decision.action === 'direct') {
    return {
      decision,
      gitConfigArgs: ['-c', 'http.proxy=', '-c', 'https.proxy='],
      env: {
        HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '',
        http_proxy: '', https_proxy: '', all_proxy: '',
      },
    }
  }
  return { decision, gitConfigArgs: [], env: {} }
}
