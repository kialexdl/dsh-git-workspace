import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { GitWorkspaceApi } from './api.ts'
import { GitWorkspaceIcon, GitWorkspacePanel } from './native-panel.tsx'
import { NetworkSettingsCard, NetworkSettingsController } from './NetworkSettingsCard.tsx'
import { injectStyles } from './styles.ts'

export const name = 'git-workspace-client'
export const inject = ['slots', 'connection', 'settingsScope', 'layout']
export const PANEL_ID = 'dsh-git-workspace'

export function apply(ctx: Context): void {
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  if (connection === undefined) throw new Error('dsh-git-workspace: connection service unavailable')
  const api = new GitWorkspaceApi(connection)
  ctx.effect(injectStyles, 'dsh-git-workspace: styles')
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    inject: () => ({ api, close: () => ctx.layout.selectPanel(null) }),
  }, GitWorkspacePanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 30,
    label: 'Git 工作台',
  }, GitWorkspaceIcon))

  const settings = new NetworkSettingsController(ctx.settingsScope.bind({ namespace: PANEL_ID }))
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: PANEL_ID,
    inject: () => ({ controller: settings }),
  }, NetworkSettingsCard))
}
