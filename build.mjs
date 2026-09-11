import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'

const PACKAGE_ID = 'dsh-git-workspace'
const common = {
  bundle: true,
  sourcemap: true,
  target: ['es2022'],
  logLevel: 'info',
}

await mkdir('lib', { recursive: true })

await build({
  ...common,
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  format: 'esm',
  platform: 'node',
  external: ['@deepseek-ai/*', '@deepseek-ai/cordis', 'schemastery'],
})

const client = await build({
  ...common,
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.body.js',
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@deepseek-ai/*'],
  write: false,
})

const bodyFile = client.outputFiles.find(file => file.path.endsWith('client.body.js'))
if (bodyFile === undefined) throw new Error('esbuild did not return the client JavaScript output')
const body = bodyFile.text
if (body.trimStart().startsWith('{\n  "version": 3')) {
  throw new Error('refusing to wrap a source map as client JavaScript')
}
const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(PACKAGE_ID)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${body}
    return module.exports;
  },
});\n`
await writeFile('lib/client.js', wrapped)
