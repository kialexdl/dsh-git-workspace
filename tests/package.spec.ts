import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function text(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('distributable plugin package', () => {
  it('declares the host, client, bundle patch, and exact build command', async () => {
    const pkg = JSON.parse(await text('package.json')) as Record<string, any>
    expect(pkg.main).toBe('lib/index.js')
    expect(pkg.exports['./client'].default).toBe('./lib/client.js')
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(pkg.dsh.client.platform).toBe('web')
    expect(pkg.scripts.build).toContain('node build.mjs')
    expect(await text('cordis.patch.yml')).toContain('name: dsh-git-workspace')
  })

  it('ships repository hygiene and complete user documentation', async () => {
    expect(await text('.gitignore')).toContain('node_modules/')
    const readme = await text('README.md')
    expect(readme).toContain('pnpm install')
    expect(readme).toContain('pnpm build')
    expect(readme).toContain('dsh plugin --profile web add ./')
    expect(readme).toContain('dsh plugin add ./')
    expect(readme).toContain('DSH Settings')
    expect(await text('docs/DESIGN.md')).toContain('## 12. UCD 验收场景')
    expect(await text('docs/USAGE.md')).toContain('## 11. 代理设置')
    expect(await text('docs/SECURITY.md')).toContain('## 信任边界')
  })

  it('selects JavaScript rather than the source map for the client wrapper', async () => {
    const build = await text('build.mjs')
    expect(build).toContain("file.path.endsWith('client.body.js')")
    expect(build).toContain('refusing to wrap a source map')
  })

  it('owns exact routes without intercepting the shared /api gateway', async () => {
    const host = await text('src/host/transport.ts')
    const protocol = await text('src/shared/protocol.ts')
    expect(host).toContain('connection.fetch.register(')
    expect(host).not.toContain('rpc.intercept(')
    expect(protocol).toContain("RPC_CHANNEL = '/api'")
  })

  it('keeps Remotes hints out of the compact URL grid', async () => {
    const styles = await text('src/client/styles.ts')
    expect(styles).toContain('.dgw-remotes .dgw-hint{display:block;width:100%')
    expect(styles).not.toContain('.dgw-remotes p{display:grid')
  })
})
