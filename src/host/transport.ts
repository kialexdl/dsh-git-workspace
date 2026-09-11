import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { RPC, RPC_CHANNEL, rpcMethod } from '../shared/protocol.ts'

/**
 * Exact routes participate in Connection's authenticated /api carrier without
 * intercepting its gateway. Avoid rpc.handle(): in DSH 0.1.5-rc.1 it reads
 * webServer through the Connection provider's shadow context during registration.
 */
export function registerTransport(connection: HostConnectionHandle, handler: ConnectionRpcHandler): void {
  for (const endpoint of Object.values(RPC)) {
    connection.fetch.register({
      path: `${RPC_CHANNEL}/${rpcMethod(endpoint)}`,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
        if (mediaType !== 'application/json') return new Response('Expected application/json', { status: 415 })
        let body: unknown
        try { body = await request.json() } catch { return new Response('Invalid JSON', { status: 400 }) }
        const envelope = clientRequestSchema.safeParse(body)
        if (!envelope.success) return new Response('Invalid RPC envelope', { status: 400 })
        const message = envelope.data
        if (message.method !== rpcMethod(endpoint)) return new Response('RPC method does not match endpoint', { status: 400 })
        const result = await handler(endpoint, message.payload, request.signal)
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result })
      },
    })
  }
}
