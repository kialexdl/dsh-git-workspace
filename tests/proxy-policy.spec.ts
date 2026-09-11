import { describe, expect, it } from 'vitest'
import { decideProxy, hostMatches, networkExecution, remoteTarget } from '../src/host/proxy-policy.ts'

describe('proxy policy', () => {
  it('parses HTTPS and scp-style SSH remotes', () => {
    expect(remoteTarget('https://github.com/acme/repo.git')).toMatchObject({ protocol: 'https', host: 'github.com' })
    expect(remoteTarget('git@code.example.com:team/repo.git')).toMatchObject({ protocol: 'ssh', host: 'code.example.com' })
  })

  it('matches exact and wildcard host patterns', () => {
    expect(hostMatches('github.com', 'github.com')).toBe(true)
    expect(hostMatches('raw.githubusercontent.com', '*.githubusercontent.com')).toBe(true)
    expect(hostMatches('github.com', '*.githubusercontent.com')).toBe(false)
  })

  it('applies block, direct, proxy, then default precedence', () => {
    const settings = {
      proxyUrl: 'http://user:password@127.0.0.1:7890',
      proxyHosts: ['*.example.com', 'github.com'],
      directHosts: ['git.example.com'],
      blockHosts: ['blocked.example.com'],
      defaultAction: 'inherit' as const,
    }
    expect(decideProxy('https://blocked.example.com/a.git', settings).action).toBe('block')
    expect(decideProxy('https://git.example.com/a.git', settings).action).toBe('direct')
    const proxied = decideProxy('https://github.com/a.git', settings)
    expect(proxied.action).toBe('proxy')
    expect(proxied.endpoint).toBe('http://127.0.0.1:7890')
    expect(JSON.stringify(proxied)).not.toContain('password')
    expect(decideProxy('https://unknown.test/a.git', settings).action).toBe('inherit')
  })

  it('never applies an HTTP proxy to SSH', () => {
    const decision = decideProxy('git@github.com:team/repo.git', {
      proxyUrl: 'http://127.0.0.1:7890',
      proxyHosts: ['github.com'],
    })
    expect(decision.action).toBe('block')
    expect(decision.source).toBe('unsupported')
  })

  it('clears inherited proxy variables for direct mode', () => {
    const execution = networkExecution('https://git.company.local/repo.git', {
      directHosts: ['git.company.local'],
    })
    expect(execution.decision.action).toBe('direct')
    expect(execution.gitConfigArgs).toContain('http.proxy=')
    expect(execution.env.HTTPS_PROXY).toBe('')
    expect(execution.env.https_proxy).toBe('')
  })
})
