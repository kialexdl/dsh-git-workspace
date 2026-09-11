import { rm } from 'node:fs/promises'

await rm('lib', { recursive: true, force: true })
for (const file of ['tsconfig.host.tsbuildinfo', 'tsconfig.client.tsbuildinfo']) {
  await rm(file, { force: true })
}
