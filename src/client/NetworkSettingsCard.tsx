import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { NetworkSettings } from '../shared/protocol.ts'

function lines(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map(item => item.trim()).filter(Boolean))]
}

function joined(value: string[] | undefined): string {
  return (value ?? []).join('\n')
}

export class NetworkSettingsController {
  constructor(readonly scope: ConfigForm<NetworkSettings>) {}
  subscribe = (listener: () => void): (() => void) => this.scope.subscribe(listener)
  getSnapshot = () => this.scope.getSnapshot()
}

export function NetworkSettingsCard({ controller }: { controller: NetworkSettingsController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const value = snapshot.value ?? {}
  const [proxyUrl, setProxyUrl] = useState('')
  const [proxyHosts, setProxyHosts] = useState(joined(value.proxyHosts))
  const [directHosts, setDirectHosts] = useState(joined(value.directHosts))
  const [blockHosts, setBlockHosts] = useState(joined(value.blockHosts))
  const [defaultAction, setDefaultAction] = useState(value.defaultAction ?? 'inherit')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const baseline = useMemo(() => JSON.stringify({
    proxyHosts: value.proxyHosts ?? [],
    directHosts: value.directHosts ?? [],
    blockHosts: value.blockHosts ?? [],
    defaultAction: value.defaultAction ?? 'inherit',
  }), [value.blockHosts, value.defaultAction, value.directHosts, value.proxyHosts])

  useEffect(() => {
    if (dirty) return
    setProxyHosts(joined(value.proxyHosts))
    setDirectHosts(joined(value.directHosts))
    setBlockHosts(joined(value.blockHosts))
    setDefaultAction(value.defaultAction ?? 'inherit')
  }, [baseline, dirty])

  if (snapshot.status === 'loading') return null
  if (snapshot.status !== 'ready') {
    return <section className="dgw-settings-card"><strong>Git 工作台网络</strong><p>当前 DSH 未提供此配置条目的可编辑表单。请检查是否为本地 Web 页面及插件配置是否启用。</p></section>
  }

  const edit = (setter: (next: string) => void) => (next: string): void => {
    setter(next)
    setDirty(true)
    setNotice('')
  }
  const save = async (): Promise<void> => {
    if (!snapshot.writable || saving) return
    setSaving(true)
    setNotice('')
    const ops: Array<{ op: 'set'; path: string[]; value: string | string[] } | { op: 'unset'; path: string[] }> = [
      { op: 'set', path: ['proxyHosts'], value: lines(proxyHosts) },
      { op: 'set', path: ['directHosts'], value: lines(directHosts) },
      { op: 'set', path: ['blockHosts'], value: lines(blockHosts) },
      { op: 'set', path: ['defaultAction'], value: defaultAction },
    ]
    if (proxyUrl.trim() !== '') ops.push({ op: 'set', path: ['proxyUrl'], value: proxyUrl.trim() })
    try {
      const accepted = await controller.scope.mutate(ops, snapshot.revision)
      if (!accepted) {
        setNotice('保存被拒绝或配置已被其他操作更新，请检查最新值后重试。')
        return
      }
    } catch (error) {
      setNotice(`保存失败：${String(error)}`)
      return
    } finally {
      setSaving(false)
    }
    setProxyUrl('')
    setDirty(false)
    setNotice('已保存。代理地址是只写字段，保存后不会回显。')
  }
  const clearProxy = async (): Promise<void> => {
    if (!snapshot.writable || !window.confirm('确认清除 Git 工作台保存的代理地址？')) return
    setSaving(true)
    try {
      const accepted = await controller.scope.unset('proxyUrl')
      if (!accepted) {
        setNotice('清除代理地址被拒绝，请检查配置权限或重试。')
        return
      }
      setProxyUrl('')
      setNotice('代理地址已清除。')
    } catch (error) {
      setNotice(`清除失败：${String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="dgw-settings-card">
      <details>
        <summary><span><strong>Git 工作台网络</strong><small>按 Remote 实际主机决定代理、直连或阻止</small></span><span>{dirty ? '未保存' : ''}</span></summary>
        <div className="dgw-settings-body">
          <label>代理地址（只写）
            <input type="password" autoComplete="off" value={proxyUrl} placeholder="http://127.0.0.1:7890" disabled={!snapshot.writable} onChange={event => edit(setProxyUrl)(event.target.value)} />
            <small>留空保存不会覆盖现有地址；支持在 URL 中包含认证信息，浏览器永远不会读回。</small>
          </label>
          <div className="dgw-settings-grid">
            <label>走代理的主机
              <textarea rows={5} value={proxyHosts} placeholder={'github.com\n*.githubusercontent.com'} disabled={!snapshot.writable} onChange={event => edit(setProxyHosts)(event.target.value)} />
            </label>
            <label>强制直连的主机
              <textarea rows={5} value={directHosts} placeholder={'git.company.local\n*.corp.example'} disabled={!snapshot.writable} onChange={event => edit(setDirectHosts)(event.target.value)} />
            </label>
            <label>禁止访问的主机
              <textarea rows={5} value={blockHosts} placeholder="untrusted.example" disabled={!snapshot.writable} onChange={event => edit(setBlockHosts)(event.target.value)} />
            </label>
          </div>
          <label>未命中主机列表时
            <select value={defaultAction} disabled={!snapshot.writable} onChange={event => {
              setDefaultAction(event.target.value as 'inherit' | 'direct' | 'block')
              setDirty(true)
              setNotice('')
            }}>
              <option value="inherit">继承 Host 环境</option>
              <option value="direct">强制直连</option>
              <option value="block">阻止访问</option>
            </select>
          </label>
          <p className="dgw-settings-order">决策顺序：禁止访问 → 强制直连 → 走代理 → 默认动作。Fetch URL 与 Push URL 分别判断；失败不会静默回退直连。</p>
          {notice !== '' && <p className="dgw-settings-notice" role="status">{notice}</p>}
          <div className="dgw-settings-actions">
            <button type="button" className="danger" disabled={!snapshot.writable || saving} onClick={() => { void clearProxy() }}>清除代理地址</button>
            <button type="button" disabled={!dirty || saving || !snapshot.writable} onClick={() => {
              setProxyUrl('')
              setProxyHosts(joined(value.proxyHosts))
              setDirectHosts(joined(value.directHosts))
              setBlockHosts(joined(value.blockHosts))
              setDefaultAction(value.defaultAction ?? 'inherit')
              setDirty(false)
            }}>放弃修改</button>
            <button type="button" className="primary" disabled={!dirty || saving || !snapshot.writable} onClick={() => { void save() }}>{saving ? '保存中…' : '保存'}</button>
          </div>
        </div>
      </details>
    </section>
  )
}
