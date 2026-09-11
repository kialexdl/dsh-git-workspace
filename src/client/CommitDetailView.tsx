import type { CommitDetail, CommitFileChange } from '../shared/protocol.ts'

function statusLabel(status: string): string {
  const code = status[0]
  if (code === 'A') return '新增'
  if (code === 'D') return '删除'
  if (code === 'R') return '重命名'
  if (code === 'C') return '复制'
  if (code === 'M') return '修改'
  return status
}

export function CommitDetailView({
  detail,
  disabled = false,
  onOpenFile,
}: {
  detail: CommitDetail
  disabled?: boolean
  onOpenFile?: (file: CommitFileChange) => void
}) {
  return (
    <div className="dgw-commit-detail">
      <pre>{detail.message}</pre>
      <dl>
        <div><dt>作者</dt><dd>{detail.author}</dd></div>
        <div><dt>时间</dt><dd>{new Date(detail.authoredAt).toLocaleString()}</dd></div>
        <div><dt>提交</dt><dd><code title={detail.hash}>{detail.hash}</code></dd></div>
        {detail.parents.length > 0 && <div><dt>父提交</dt><dd>{detail.parents.map(parent => <code title={parent} key={parent}>{parent.slice(0, 12)}</code>)}</dd></div>}
      </dl>
      <h3>变更文件（{String(detail.files.length)}）</h3>
      <ul>
        {detail.files.map(file => (
          <li key={`${file.status}:${file.originalPath ?? ''}:${file.path}`}>
            <button type="button" disabled={disabled || onOpenFile === undefined} onClick={() => onOpenFile?.(file)}>
              <span className={`dgw-commit-file-status status-${file.status[0]?.toLowerCase() ?? 'x'}`}>{statusLabel(file.status)}</span>
              <code title={file.path}>{file.originalPath === undefined ? file.path : `${file.originalPath} → ${file.path}`}</code>
              <span className="dgw-commit-file-open">查看内容</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
