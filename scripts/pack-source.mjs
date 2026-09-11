import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const version = process.env.npm_package_version ?? '0.0.0'
const output = `dsh-git-workspace-${version}-source.zip`
await run('git', ['archive', '--format=zip', `--output=${output}`, 'HEAD'])
console.log(output)
