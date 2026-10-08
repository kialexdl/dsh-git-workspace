// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { SlotCore, type PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { apply, PANEL_ID } from '../src/client/index.tsx'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('registers native slots, opens with no sessions, and returns through DSH layout', async () => {
  const slots = new SlotCore()
  const disposeRoot = slots.register({ name: 'root', children: {
    main: { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
    'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
  } }, ({ renderSlot }: PropsRenderSlots<'main' | 'sidebar.panellist' | 'plugins.bundle.config'>) => <>
    {renderSlot('main', {}, { entryKey: PANEL_ID })}
    {renderSlot('sidebar.panellist', { size: 18, active: false })}
    {renderSlot('plugins.bundle.config', { view: 'page' }, { entryKey: PANEL_ID })}
  </>)
  const disposers: Array<() => void> = []
  const close = vi.fn()
  const call = vi.fn().mockResolvedValue({ ok: true, value: [] })
  const context = {
    get: () => ({ rpc: { call } }),
    slots: {
      register: slots.register.bind(slots),
      inject: (_key: string, register: () => () => void) => {
        // The slot registry owns its lifetime; expose a disposer to the
        // nested configForms.whileServed() registration as in the real DSH API.
        disposers.push(register())
        return () => {}
      },
    },
    effect: (effect: () => () => void) => { disposers.push(effect()) },
    configForms: {
      get: () => ({
        getSnapshot: () => ({
          status: 'ready', value: { proxyHosts: [], directHosts: [], blockHosts: [], defaultAction: 'inherit' },
          base: {}, user: {}, revision: 0, writable: true, mode: 'host',
        }),
        subscribe: () => () => {},
        mutate: vi.fn().mockResolvedValue(true),
        unset: vi.fn().mockResolvedValue(true),
      }),
      whileServed: (_namespaces: string[], register: (served: ReadonlySet<string>) => () => void) =>
        register(new Set(['git-workspace'])),
    },
    layout: { selectPanel: close },
  } as unknown as Context
  apply(context)
  const main = slots.entries('main')[0]!
  expect(main.options.key).toBe(PANEL_ID)
  expect(slots.entries('sidebar.panellist')[0]?.options).toMatchObject({ id: PANEL_ID, label: 'Git 工作台' })
  expect(slots.entries('plugins.bundle.config')[0]?.options.key).toBe(PANEL_ID)
  const props = main.inject!()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(main.component as ComponentType<object>, props)) })
    expect(call).toHaveBeenCalled()
    expect(container.querySelector('.dgw-shell')).not.toBeNull()
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === '关闭并返回会话')!
    await act(async () => { button.click() })
    expect(close).toHaveBeenCalledWith(null)
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
    for (const dispose of disposers.reverse()) dispose()
    disposeRoot()
  }
  expect(slots.entries('main')).toEqual([])
  expect(document.querySelector('[data-plugin-css]')).toBeNull()
})
