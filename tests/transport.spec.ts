import { describe, expect, it, vi } from 'vitest'
import { GitWorkspaceApi } from '../src/client/api.ts'
import { configValue, dispatch } from '../src/index.ts'
import { RPC, RPC_CHANNEL, rpcMethod } from '../src/shared/protocol.ts'

describe('Host/Client transport contract', () => {
  it('detaches readonly volatile arrays from plugin configuration snapshots', () => {
    const hosts = Object.freeze(['github.com'])
    const ignored = Object.freeze(['node_modules'])
    const wrap = (value: unknown) => ({ get: () => value })
    const state = configValue({
      enabled: wrap(true),
      scanDepth: wrap(4),
      ignoredDirectories: wrap(ignored),
      proxyUrl: wrap(undefined),
      proxyHosts: wrap(hosts),
      directHosts: wrap(Object.freeze(['git.local'])),
      blockHosts: wrap(Object.freeze(['blocked.local'])),
      defaultAction: wrap('inherit'),
    } as never)
    expect(state.proxyHosts).toEqual(['github.com'])
    expect(state.ignoredDirectories).toEqual(['node_modules'])
    state.proxyHosts.push('second.example')
    state.ignoredDirectories.push('dist')
    expect(hosts).toEqual(['github.com'])
    expect(ignored).toEqual(['node_modules'])
  })

  it('calls the plugin-owned channel and unwraps a successful response', async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, value: [{ workspaceId: 'ws-1' }] })
    const api = new GitWorkspaceApi({ rpc: { call } } as never)

    await expect(api.workspaces()).resolves.toEqual([{ workspaceId: 'ws-1' }])
    expect(call).toHaveBeenCalledWith(RPC_CHANNEL, rpcMethod(RPC.workspaces), {}, undefined)
  })

  it('preserves structured Host errors', async () => {
    const call = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'internal', message: 'blocked', details: { pluginCode: 'REMOTE_BLOCKED' } },
    })
    const api = new GitWorkspaceApi({ rpc: { call } } as never)

    await expect(api.workspaces()).rejects.toMatchObject({ message: 'blocked', code: 'internal' })
  })

  it('dispatches batch operations without requiring a single repoId', async () => {
    const batch = vi.fn().mockResolvedValue({ results: [] })
    const signal = new AbortController().signal

    await expect(dispatch({ batch } as never, RPC.batch, {
      workspaceId: 'ws-1',
      repoIds: ['repo-a', 'repo-b'],
      action: 'pull',
    }, signal)).resolves.toEqual({ results: [] })
    expect(batch).toHaveBeenCalledWith('ws-1', ['repo-a', 'repo-b'], 'pull', signal)
  })

  it('dispatches an explicit remote-branch checkout', async () => {
    const checkout = vi.fn().mockResolvedValue({ summary: { branch: 'feature' } })
    const signal = new AbortController().signal

    await dispatch({ checkout } as never, RPC.checkout, {
      workspaceId: 'ws-1', repoId: 'repo-a', branch: 'origin/feature', remote: true,
    }, signal)
    expect(checkout).toHaveBeenCalledWith('ws-1', 'repo-a', 'origin/feature', true, signal)
  })

  it('dispatches commit file diffs with an explicit hash and path', async () => {
    const commitDiff = vi.fn().mockResolvedValue('patch')
    const signal = new AbortController().signal

    await expect(dispatch({ commitDiff } as never, RPC.commitDiff, {
      workspaceId: 'ws-1', repoId: 'repo-a', hash: '1'.repeat(40), path: 'src/index.ts',
    }, signal)).resolves.toBe('patch')
    expect(commitDiff).toHaveBeenCalledWith('ws-1', 'repo-a', '1'.repeat(40), 'src/index.ts', signal)
  })
})

// Exercise the real request parser against exact-route handlers, including the
// URL/body method agreement that prevents an allowed route dispatching another action.
describe('DSH 0.2.1 exact Fetch transport', () => {
  async function mounted() {
    const { registerTransport } = await import('../src/host/transport.ts')
    const routes: import('@deepseek-ai/dsh-client-connection').ConnectionFetchRoute[] = []
    const handler = vi.fn().mockResolvedValue({ ok: true, value: ['workspace'] })
    const peer = { kind: 'authenticated-operator' }
    registerTransport({ operator: peer, fetch: { register(route: import('@deepseek-ai/dsh-client-connection').ConnectionFetchRoute) { routes.push(route); return async () => {} } } } as never, handler)
    return { route: routes.find(item => item.path === `${RPC_CHANNEL}/${rpcMethod(RPC.workspaces)}`)!, routes, handler, peer }
  }
  const request = (body: string, type = 'application/json') => new Request(`http://localhost${RPC_CHANNEL}/${rpcMethod(RPC.workspaces)}`, {
    method: 'POST', headers: { 'content-type': type }, body,
  })

  it('registers disjoint exact endpoints and preserves the client correlation id', async () => {
    const { route, routes, handler, peer } = await mounted()
    expect(new Set(routes.map(item => item.path)).size).toBe(Object.values(RPC).length)
    expect(routes.every(item => item.methods.length === 1 && item.methods[0] === 'POST' && item.requestBody === 'buffered')).toBe(true)
    const response = await route.fetch(request(JSON.stringify({ type: 'client-request', rpcId: 'test-id', method: 'git-workspace/workspaces', payload: {} })))
    expect(await response.json()).toEqual({ type: 'server-response', rpcId: 'test-id', result: { ok: true, value: ['workspace'] } })
    expect(handler).toHaveBeenCalledWith('workspaces', {}, expect.any(AbortSignal), peer)
  })

  it.each([
    ['invalid JSON', '{', 'application/json', 400],
    ['invalid envelope', '{}', 'application/json', 400],
    ['wrong media type', '{}', 'text/plain', 415],
    ['method mismatch', JSON.stringify({ type: 'client-request', rpcId: 'test-id', method: 'push', payload: {} }), 'application/json', 400],
  ] as const)('rejects %s before invoking a Git handler', async (_name, body, type, status) => {
    const { route, handler } = await mounted()
    expect((await route.fetch(request(body, type))).status).toBe(status)
    expect(handler).not.toHaveBeenCalled()
  })
})
