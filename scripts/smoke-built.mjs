import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const plugin = await import('../lib/index.js')
if (plugin.name !== 'git-workspace') throw new Error('Unexpected Host plugin identity')
if (!Array.isArray(plugin.inject) || !plugin.inject.includes('workspaceRegistry')) {
  throw new Error('Host workspace service dependency missing')
}
const config = plugin.Config({})
if (config.enabled.get() !== true || config.scanDepth.get() !== 4) {
  throw new Error('Host volatile schema defaults are not active')
}
if (config.proxyUrl.get() !== undefined) {
  throw new Error('Host volatile secret default is invalid')
}
let registration
const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
runInNewContext(client, {
  window: {
    __ModuleLoader__: {
      load(value) { registration = value },
    },
  },
})
if (registration?.id !== 'dsh-git-workspace' || typeof registration.factory !== 'function') {
  throw new Error('Client module loader registration is missing or invalid')
}
console.log('Built Host module import and Client bundle registration passed')
