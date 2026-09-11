import { spawn } from 'node:child_process'
import type { SpawnOptionsWithoutStdio } from 'node:child_process'
import { GitWorkspaceError } from './errors.ts'

const OUTPUT_LIMIT = 8 * 1024 * 1024

export interface GitRunOptions {
  cwd: string
  stdin?: string | Buffer
  signal?: AbortSignal
  env?: Record<string, string | undefined>
  allowFailure?: boolean
  outputLimit?: number
}

export interface GitResult {
  exitCode: number
  stdout: Buffer
  stderr: Buffer
}

export async function runGit(args: readonly string[], options: GitRunOptions): Promise<GitResult> {
  const spawnOptions: SpawnOptionsWithoutStdio = {
    cwd: options.cwd,
    windowsHide: true,
    shell: false,
    signal: options.signal,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
      LC_ALL: 'C',
      ...options.env,
    },
  }
  const child = spawn('git', [...args], spawnOptions)
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let size = 0
  const limit = options.outputLimit ?? OUTPUT_LIMIT
  const collect = (target: Buffer[], chunk: Buffer): void => {
    size += chunk.length
    if (size > limit) {
      child.kill()
      return
    }
    target.push(Buffer.from(chunk))
  }
  child.stdout.on('data', (chunk: Buffer) => { collect(stdout, chunk) })
  child.stderr.on('data', (chunk: Buffer) => { collect(stderr, chunk) })
  if (options.stdin !== undefined) child.stdin.end(options.stdin)
  else child.stdin.end()
  const result = await new Promise<GitResult>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => resolve({
      exitCode: code ?? -1,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
    }))
  }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new GitWorkspaceError('GIT_NOT_FOUND', '未找到 git 可执行文件，请先安装 Git 并确保它位于 PATH 中。')
    }
    throw error
  })
  if (size > limit) throw new GitWorkspaceError('OUTPUT_LIMIT', `Git 输出超过 ${String(limit)} 字节限制。`)
  if (result.exitCode !== 0 && options.allowFailure !== true) {
    const detail = result.stderr.toString('utf8').trim() || result.stdout.toString('utf8').trim()
    throw new GitWorkspaceError('GIT_FAILED', detail || `git ${args[0] ?? ''} exited with ${String(result.exitCode)}`, {
      command: args[0] ?? '',
      exitCode: result.exitCode,
    })
  }
  return result
}

export async function gitText(args: readonly string[], options: GitRunOptions): Promise<string> {
  return (await runGit(args, options)).stdout.toString('utf8')
}
