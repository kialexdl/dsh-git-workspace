export interface PanelSnapshot {
  open: boolean
}

export class PanelController {
  private snapshot: PanelSnapshot = { open: false }
  private readonly listeners = new Set<() => void>()

  constructor(private readonly onClose?: () => void) {}

  getSnapshot = (): PanelSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  open = (): void => { this.set(true) }
  close = (): void => { this.set(false); this.onClose?.() }
  toggle = (): void => { this.set(!this.snapshot.open) }

  private set(open: boolean): void {
    if (open === this.snapshot.open) return
    this.snapshot = { open }
    for (const listener of this.listeners) listener()
  }
}
