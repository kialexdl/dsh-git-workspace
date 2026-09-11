import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { webcrypto } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import type { ConnectionHandle, RpcFetch } from '@deepseek-ai/dsh-client-connection/client'

/** Run the installed DSH browser bundle, including its actual target validator. */
export async function realConnection(fetch: RpcFetch): Promise<ConnectionHandle> {
  const require = createRequire(import.meta.url)
  const code = await readFile(require.resolve('@deepseek-ai/dsh-client-connection/client'), 'utf8')
  let plugin: { apply(ctx: { provide(name: string, value: ConnectionHandle): void }): void } | undefined
  runInNewContext(code, {
    window: { __ModuleLoader__: { load(entry: { factory(require: (id: string) => never): typeof plugin }) {
      plugin = entry.factory(id => { throw new Error(`Unexpected external module: ${id}`) })
    } } },
    __DSH_TRANSPORT__: { fetch },
    crypto: webcrypto, URL, URLSearchParams, AbortController, AbortSignal,
    Request, Response, Headers, TextEncoder, TextDecoder, console, setTimeout, clearTimeout,
  })
  let connection: ConnectionHandle | undefined
  plugin!.apply({ provide(name, value) { if (name === 'connection') connection = value } })
  if (!connection) throw new Error('DSH browser bundle did not provide Connection')
  return connection
}
