import type { DesktopBackupSummary } from '../types/desktop'

interface Props {
  backup: DesktopBackupSummary
  onRemove: () => void
}

const FORMAT_LABEL: Record<string, string> = {
  zip_legacy: 'ZIP (JSON)',
  bak: 'BAK',
  json: 'JSON',
  zip_direct: 'ZIP (直接备份)',
  unknown: '未知',
}

function StatBadge({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center py-1.5 rounded bg-zinc-100 dark:bg-zinc-950/45 border border-zinc-200 dark:border-zinc-900/65">
      <span className="text-xs font-semibold text-zinc-750 dark:text-zinc-300">{value.toLocaleString()}</span>
      <span className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-0.5">{label}</span>
    </div>
  )
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fmtDate(ts?: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function BackupCard({ backup, onRemove }: Props) {
  const isValid = backup.status === 'ready' || backup.status === 'selected' || backup.status === 'analyzing'
  const hasStats = backup.status === 'ready' && backup.stats
  const isDirectBackup = backup.format === 'zip_direct'

  return (
    <div
      className={[
        'group rounded-xl border p-3.5 transition-all duration-200',
        isValid
          ? 'bg-zinc-50 dark:bg-zinc-900/25 border-zinc-200 dark:border-zinc-800/80 hover:bg-zinc-100 dark:hover:bg-zinc-900/40 hover:border-zinc-300 dark:hover:border-zinc-700/70'
          : 'bg-red-50 dark:bg-red-950/10 border-red-200 dark:border-red-900/20',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Icon + name */}
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={[
              'w-8.5 h-8.5 rounded-lg flex items-center justify-center shrink-0 transition-colors border',
              isValid ? 'bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-900 group-hover:bg-zinc-50 dark:group-hover:bg-zinc-900' : 'bg-red-100 dark:bg-red-950/30 border-red-200 dark:border-red-900/20',
            ].join(' ')}
          >
            {isValid ? (
              <svg className="w-4.5 h-4.5 text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
              </svg>
            ) : (
              <svg className="w-4.5 h-4.5 text-red-500 dark:text-red-400 group-hover:text-red-700 dark:group-hover:text-red-300 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
              </svg>
            )}
          </div>

          <div className="min-w-0">
            <p className="text-xs font-semibold text-zinc-850 dark:text-zinc-200 truncate leading-snug">{backup.fileName}</p>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className="text-[10px] text-zinc-500 font-mono">{fmtSize(backup.fileSize)}</span>
              <span className="text-[10px] text-zinc-300 dark:text-zinc-700">·</span>
              <span
                className={[
                  'text-[9px] px-1.5 py-0.5 rounded font-semibold tracking-tight border',
                  isValid
                    ? 'bg-zinc-100 dark:bg-zinc-900/60 text-zinc-650 dark:text-zinc-400 border-zinc-250 dark:border-zinc-800'
                    : isDirectBackup
                      ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-750 dark:text-amber-400 border-amber-200 dark:border-amber-900/20'
                      : 'bg-red-100 dark:bg-red-950/40 text-red-750 dark:text-red-400 border-red-200 dark:border-red-900/20',
                ].join(' ')}
              >
                {FORMAT_LABEL[backup.format] ?? '未知'}
              </span>
              {backup.version > 0 && (
                <>
                  <span className="text-[10px] text-zinc-300 dark:text-zinc-700">·</span>
                  <span className="text-[10px] text-zinc-500 font-mono">v{backup.version}</span>
                </>
              )}
              {backup.time && (
                <>
                  <span className="text-[10px] text-zinc-300 dark:text-zinc-700">·</span>
                  <span className="text-[10px] text-zinc-500 font-mono">{fmtDate(backup.time)}</span>
                </>
              )}
              {backup.status === 'selected' && (
                <>
                  <span className="text-[10px] text-zinc-300 dark:text-zinc-700">·</span>
                  <span className="text-[10px] text-blue-500 dark:text-blue-400 font-semibold animate-pulse">待分析</span>
                </>
              )}
              {backup.status === 'analyzing' && (
                <>
                  <span className="text-[10px] text-zinc-300 dark:text-zinc-700">·</span>
                  <span className="text-[10px] text-amber-600 dark:text-amber-500 font-semibold animate-pulse">分析中...</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Remove button */}
        <button
          onClick={onRemove}
          className="shrink-0 w-6.5 h-6.5 flex items-center justify-center rounded-lg text-zinc-450 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800/50 transition-colors"
          title="移除"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Error message */}
      {backup.error && (
        <div className="mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 text-[11px] text-red-700 dark:text-red-300/90 whitespace-pre-wrap leading-relaxed">
          {backup.error}
        </div>
      )}

      {/* ZIP 内容诊断 */}
      {backup.zipFiles && backup.zipFiles.length > 0 && (
        <details className="mt-2.5">
          <summary className="text-[10px] text-zinc-500 dark:text-zinc-500 cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-400 select-none font-medium">
            查看 ZIP 内容 ({backup.zipFiles.length} 项)
          </summary>
          <div className="mt-1.5 p-2 rounded-lg bg-zinc-100/50 dark:bg-zinc-950/50 border border-zinc-250/80 dark:border-zinc-900/80 max-h-32 overflow-y-auto">
            {backup.zipFiles.map((f, i) => (
              <div key={i} className="text-[10px] text-zinc-500 dark:text-zinc-500 font-mono truncate leading-5">
                {f}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Stats */}
      {hasStats && (
        <div className="mt-3 grid grid-cols-5 gap-1.5 pt-3 border-t border-zinc-200 dark:border-zinc-800/60">
          <StatBadge label="话题" value={backup.stats!.topicsCount} />
          <StatBadge label="消息" value={backup.stats!.messagesCount} />
          <StatBadge label="助手" value={backup.stats!.assistantsCount} />
          <StatBadge label="服务商" value={backup.stats!.providersCount} />
          <StatBadge label="智能体" value={backup.stats!.agentsCount} />
        </div>
      )}
    </div>
  )
}

