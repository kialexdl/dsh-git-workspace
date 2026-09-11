import { describe, expect, it, vi } from 'vitest'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { GitWorkspaceApi } from '../src/client/api.ts'
import { registerTransport } from '../src/host/transport.ts'
import { RPC, RPC_CHANNEL, rpcMethod } from '../src/shared/protocol.ts'
import { realConnection } from './helpers/real-connection.ts'

describe('published DSH browser Connection → plugin Host transport', () => {
  async function setup() {
    const routes = new Map<string, ConnectionFetchRoute>()
    const dispatch = vi.fn(async (endpoint: string, payload: unknown) => ({ ok: true as const, value: { endpoint, payload } }))
    registerTransport({ fetch: { register(route: ConnectionFetchRoute) {
      routes.set(route.path, route)
      return async () => { routes.delete(route.path) }
    } } } as never, dispatch)
    const fetch = vi.fn(async (url: URL, init: RequestInit) => {
      const route = routes.get(url.pathname)
      if (!route) return new Response('Not found', { status: 404 })
      return route.fetch(new Request(url, init))
    })
    return { connection: await realConnection(fetch), dispatch, fetch }
  }

  it('reproduces the 0.2.0 multi-segment channel error before network I/O', async () => {
    const { connection, fetch } = await setup()
    await expect(connection.rpc.call('/api/git-workspace', 'workspaces', {}))
      .rejects.toThrow('connection: invalid RPC target')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('loads workspaces and nested commit diffs through the real client validator', async () => {
    const { connection, dispatch } = await setup()
    const api = new GitWorkspaceApi(connection)
    await expect(api.workspaces()).resolves.toEqual({ endpoint: 'workspaces', payload: {} })
    await api.commitDiff('ws', 'repo', 'a'.repeat(40), 'src/main.ts')
    expect(dispatch).toHaveBeenLastCalledWith('commit/diff', {
      workspaceId: 'ws', repoId: 'repo', hash: 'a'.repeat(40), path: 'src/main.ts',
    }, expect.any(AbortSignal))
  })

  it.each(Object.values(RPC))('round-trips the %s endpoint without rewriting its dispatch identity', async endpoint => {
    const { connection } = await setup()
    await expect(connection.rpc.call(RPC_CHANNEL, rpcMethod(endpoint), { marker: endpoint }))
      .resolves.toEqual({ ok: true, value: { endpoint, payload: { marker: endpoint } } })
  })
})
