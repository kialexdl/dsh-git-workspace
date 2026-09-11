export class GitWorkspaceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'GitWorkspaceError'
  }
}

export function asError(value: unknown): GitWorkspaceError {
  if (value instanceof GitWorkspaceError) return value
  return new GitWorkspaceError('INTERNAL', value instanceof Error ? value.message : String(value))
}
