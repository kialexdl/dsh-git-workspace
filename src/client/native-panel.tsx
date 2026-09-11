import { useMemo } from 'react'
import type { SidebarPanelIconOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { GitWorkspaceApi } from './api.ts'
import { PanelController } from './panel-controller.ts'
import { Workbench } from './Workbench.tsx'

/** DSH owns the row, accessible label, selection state and collapsed sidebar. */
export function GitWorkspaceIcon({ size }: SidebarPanelIconOwnerProps) {
  return <svg viewBox="0 0 18 18" width={size} height={size} fill="none" stroke="currentColor"
    strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="5" cy="4" r="1.6" /><circle cx="13" cy="14" r="1.6" /><circle cx="5" cy="14" r="1.6" />
    <path d="M5 5.6v6.8M6.6 4h2.2a4.2 4.2 0 0 1 4.2 4.2v4.2" />
  </svg>
}

/** The root-scoped main slot requires no current Session to mount. */
export function GitWorkspacePanel({ api, close }: { api: GitWorkspaceApi; close: () => void }) {
  const controller = useMemo(() => {
    const panel = new PanelController(close)
    panel.open()
    return panel
  }, [close])
  return <div className="dgw-view" data-dsh-plugin="git-workspace">
    <Workbench api={api} controller={controller} />
  </div>
}
