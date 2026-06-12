import { useEffect, useMemo, useState, useRef } from 'react'
import type { MergeOptions } from './types/backup'
import type { DesktopBackupSummary, DesktopMergeResponse, DesktopProgressEvent } from './types/desktop'
import Header from './components/Header'
import BackupCard from './components/BackupCard'
import MergeSettings from './components/MergeSettings'
import StepIndicator from './components/StepIndicator'

const DEFAULT_OPTIONS: MergeOptions = {
  conflictResolution: 'newer',
  primaryBackupIndex: 0,
  mergeTopics: true,
  mergeAssistants: true,
  mergeProviders: true,
  mergeAgents: true,
  settingsSource: 0,
}

function defaultOutputName() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `cherry-studio-merged-${date}.zip`
}

function fmtPath(path: string) {
  const parts = path.split(/[\\/]/)
  if (parts.length <= 3) return path
  return `.../${parts.slice(-3).join('/')}`
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-250 dark:border-zinc-900 bg-white dark:bg-zinc-950/45 px-3 py-2.5 transition-colors">
      <div className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{value.toLocaleString()}</div>
      <div className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500 font-semibold">{label}</div>
    </div>
  )
}

const IDLE_PROGRESS: DesktopProgressEvent = {
  phase: 'idle',
  percent: 0,
  message: '等待操作',
}

function mergeBackupLists(
  current: DesktopBackupSummary[],
  next: DesktopBackupSummary[],
): DesktopBackupSummary[] {
  const map = new Map<string, DesktopBackupSummary>()
  for (const item of current) map.set(item.path, item)
  for (const item of next) map.set(item.path, item)
  return Array.from(map.values())
}

function ProgressPanel({ progress, busy }: { progress: DesktopProgressEvent; busy: string | null }) {
  const visible = Boolean(busy) || (progress.phase !== 'idle' && progress.phase !== 'done')

  if (!visible) return null

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/10 p-4">
      <div className="flex items-start justify-between gap-3 text-xs">
        <div className="min-w-0">
          <h3 className="font-semibold text-zinc-700 dark:text-zinc-300">{progress.message}</h3>
          {progress.detail && <p className="mt-1 truncate text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">{progress.detail}</p>}
        </div>
        <span className="shrink-0 font-bold text-zinc-600 dark:text-zinc-300 font-mono">{progress.percent}%</span>
      </div>
      <div className="mt-3.5 h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-900">
        <div
          className="h-full bg-zinc-900 dark:bg-zinc-200 transition-all duration-300"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  )
}


export default function App() {
  const [backups, setBackups] = useState<DesktopBackupSummary[]>([])
  const [options, setOptions] = useState<MergeOptions>(DEFAULT_OPTIONS)
  const [outputPath, setOutputPath] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DesktopMergeResponse | null>(null)
  const [progress, setProgress] = useState<DesktopProgressEvent>(IDLE_PROGRESS)
  const [step, setStep] = useState<'upload' | 'configure' | 'result'>('upload')
  const [logs, setLogs] = useState<string[]>([])
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'dark' | 'light' | null
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light')
    setTheme(initialTheme)
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')
    if (window.cherryDesktop?.setTheme) {
      void window.cherryDesktop.setTheme(initialTheme)
    }
  }, [])

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    document.documentElement.classList.toggle('dark', nextTheme === 'dark')
    localStorage.setItem('theme', nextTheme)
    if (window.cherryDesktop?.setTheme) {
      void window.cherryDesktop.setTheme(nextTheme)
    }
  }

  const mergeableBackups = useMemo(() => backups.filter((backup) => backup.status !== 'error'), [backups])
  const analyzedCount = useMemo(() => backups.filter((backup) => backup.status === 'ready').length, [backups])
  const desktopApi = window.cherryDesktop
  const canAnalyze = desktopApi && mergeableBackups.length > 0 && !busy
  const canMerge = desktopApi && mergeableBackups.length >= 2 && outputPath && !busy

  useEffect(() => {
    if (!desktopApi) return undefined
    return desktopApi.onProgress((event) => {
      setProgress(event)
      if (event.log) {
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
        setLogs((prev) => [...prev, `[${time}] ${event.log}`])
      }
    })
  }, [desktopApi])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    if (mergeableBackups.length >= 2 && options.primaryBackupIndex === 0 && options.settingsSource === 0) {
      setOptions((prev) => ({
        ...prev,
        settingsSource: 1,
      }))
    }
  }, [mergeableBackups.length])

  useEffect(() => {
    if (!desktopApi) return


    let cancelled = false
    const api = desktopApi
    async function loadSamples() {
      setBusy('正在读取项目内示例备份路径...')
      setError(null)
      try {
        const samples = await api.getSampleBackups()
        if (!cancelled && samples.length > 0) setBackups(samples)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setBusy(null)
      }
    }

    void loadSamples()
    return () => {
      cancelled = true
    }
  }, [desktopApi])

  const chooseBackups = async (mode: 'replace' | 'append') => {
    if (!desktopApi) return
    setBusy('正在选择备份...')
    setProgress({
      phase: 'selecting',
      percent: 10,
      message: mode === 'replace' ? '正在重新选择备份' : '正在追加备份',
    })
    setError(null)
    setResult(null)
    setLogs([])

    try {
      const selected = await desktopApi.selectBackups()
      if (selected.length > 0) {
        setBackups((items) => (mode === 'replace' ? selected : mergeBackupLists(items, selected)))
        if (mode === 'replace') setOptions({ ...DEFAULT_OPTIONS })
        setProgress({
          phase: 'done',
          percent: 100,
          message: mode === 'replace' ? '已重新选择备份' : '已追加备份',
          detail: `${selected.length} 个文件`,
        })
      } else {
        setProgress(IDLE_PROGRESS)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setProgress({
        phase: 'error',
        percent: 100,
        message: '选择备份失败',
      })
    } finally {
      setBusy(null)
    }
  }

  const analyzeBackups = async () => {
    if (!desktopApi || !canAnalyze) return
    const paths = mergeableBackups.map((backup) => backup.path)
    setBusy('正在分析备份内容...')
    setProgress({
      phase: 'analyzing',
      percent: 1,
      message: '准备分析备份',
    })
    setError(null)
    setResult(null)
    setLogs([])

    setBackups((items) =>
      items.map((item) =>
        paths.includes(item.path) ? { ...item, status: 'analyzing', error: undefined } : item,
      ),
    )
    try {
      const inspected = await desktopApi.inspectBackups(paths)
      setBackups(inspected)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setProgress({
        phase: 'error',
        percent: 100,
        message: '分析失败',
      })
      setBackups((items) =>
        items.map((item) =>
          paths.includes(item.path) ? { ...item, status: 'selected' } : item,
        ),
      )
    } finally {
      setBusy(null)
    }
  }

  const chooseOutput = async () => {
    if (!desktopApi) return
    setError(null)
    const selected = await desktopApi.chooseOutputPath(defaultOutputName())
    if (selected) setOutputPath(selected)
  }

  const merge = async () => {
    if (!desktopApi || !canMerge) return
    setBusy('正在合并并写入 ZIP...')
    setProgress({
      phase: 'merging',
      percent: 1,
      message: '准备合并',
      detail: `${mergeableBackups.length} 个备份`,
    })
    setError(null)
    setResult(null)
    setLogs([])

    try {
      const response = await desktopApi.mergeBackups({
        inputPaths: mergeableBackups.map((backup) => backup.path),
        outputPath,
        options: {
          ...options,
          primaryBackupIndex: Math.min(options.primaryBackupIndex, mergeableBackups.length - 1),
          settingsSource: Math.min(options.settingsSource, mergeableBackups.length - 1),
        },
      })
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setProgress({
        phase: 'error',
        percent: 100,
        message: '合并失败',
      })
    } finally {
      setBusy(null)
    }
  }

  const handleReset = () => {
    setBackups([])
    setOptions(DEFAULT_OPTIONS)
    setOutputPath('')
    setResult(null)
    setProgress(IDLE_PROGRESS)
    setStep('upload')
  }

  return (
    <div className="h-screen bg-zinc-50 dark:bg-black text-zinc-800 dark:text-zinc-200 antialiased selection:bg-zinc-200 dark:selection:bg-zinc-800 selection:text-black dark:selection:text-white flex flex-col overflow-hidden">
      <Header theme={theme} toggleTheme={toggleTheme} />

      <main className="flex-1 mx-auto w-full max-w-2xl px-4 pb-6 pt-4 flex flex-col gap-4 overflow-hidden">
        {!desktopApi && (
          <div className="border border-red-200 dark:border-red-900/30 bg-red-50 dark:bg-red-950/15 p-3.5 rounded-xl text-xs text-red-700 dark:text-red-400/90 leading-relaxed shrink-0">
            当前处于浏览器预览模式。请使用桌面客户端启动此应用，方可读取和导入 Cherry Studio 备份。
          </div>
        )}

        {/* Wizard Stepper */}
        <div className="shrink-0">
          <StepIndicator step={step} />
        </div>

        {/* Card Panel */}
        <div className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-850 bg-white dark:bg-zinc-950/45 p-5 shadow-sm dark:shadow-2xl backdrop-blur-md flex flex-col gap-4 overflow-hidden">
          {step === 'upload' && (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-900 pb-3 shrink-0">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">备份来源</h2>
                  <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">选择两份或更多 Cherry Studio 备份以进行合并。</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => chooseBackups('replace')}
                    disabled={!desktopApi || Boolean(busy)}
                    className="h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 px-3 text-xs font-semibold text-zinc-650 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-850 hover:text-zinc-900 dark:hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    选择文件
                  </button>
                  {backups.length > 0 && (
                    <button
                      type="button"
                      onClick={() => chooseBackups('append')}
                      disabled={!desktopApi || Boolean(busy)}
                      className="h-8 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 px-3 text-xs font-semibold text-zinc-650 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-850 hover:text-zinc-900 dark:hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      追加文件
                    </button>
                  )}
                </div>
              </div>

              {/* Backups List */}
              <div className="flex-1 min-h-0 space-y-2.5 overflow-y-auto pr-1.5 custom-scrollbar">
                {backups.length === 0 ? (
                  <div
                    onClick={() => chooseBackups('replace')}
                    className="flex h-56 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-850 bg-zinc-50 dark:bg-zinc-900/5 hover:bg-zinc-100 dark:hover:bg-zinc-900/10 hover:border-zinc-400 dark:hover:border-zinc-700 cursor-pointer transition-all gap-3 text-center px-4"
                  >
                    <div className="w-9 h-9 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">导入备份文件</p>
                      <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">支持多选 .zip / .bak 格式备份</p>
                    </div>
                  </div>
                ) : (
                  backups.map((backup) => (
                    <BackupCard
                      key={backup.id}
                      backup={backup}
                      onRemove={() => {
                        setBackups((items) => items.filter((item) => item.id !== backup.id))
                        setResult(null)
                      }}
                    />
                  ))
                )}
              </div>


              {/* Real-time Logs Console */}
              {logs.length > 0 && (
                <div className="border border-zinc-200 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-950/80 rounded-lg p-3 text-[10px] font-mono text-zinc-650 dark:text-zinc-400 h-28 overflow-y-auto space-y-1 select-text scrollbar-thin shrink-0">
                  {logs.map((log, i) => (
                    <div key={i} className="leading-relaxed break-all">
                      {log}
                    </div>
                  ))}
                  <div ref={logEndRef} />
                </div>
              )}

              {/* Action area */}
              {backups.length > 0 && (
                <div className="flex items-center justify-between border-t border-zinc-200 dark:border-zinc-900 pt-4 mt-auto">
                  <button
                    type="button"
                    onClick={analyzeBackups}
                    disabled={!canAnalyze}
                    className="h-9.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 px-4 text-xs font-semibold text-zinc-650 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white transition-all disabled:opacity-30 disabled:pointer-events-none"
                  >
                    {busy && busy.includes('分析') ? '正在分析内容...' : '分析备份内容'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setStep('configure')}
                    disabled={mergeableBackups.length < 2 || Boolean(busy)}
                    className="h-9.5 rounded-lg bg-zinc-950 dark:bg-white text-white dark:text-black px-4.5 text-xs font-bold hover:bg-zinc-850 dark:hover:bg-zinc-200 transition-all disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1.5"
                  >
                    继续配置
                    <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              )}
            </>
          )}

          {step === 'configure' && (
            <>
              <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-900 pb-4">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">合并配置</h2>
                  <p className="mt-1 text-[11px] text-zinc-450 dark:text-zinc-500">
                    调整冲突策略、主备份及合并的范围。已分析 {analyzedCount} / {backups.length} 个备份。
                  </p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto max-h-[450px] pr-1.5 custom-scrollbar">
                {mergeableBackups.length >= 2 ? (
                  <MergeSettings backups={mergeableBackups} options={options} onOptionsChange={setOptions} />
                ) : (
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/10 p-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
                    至少需要 2 个备份才能配置合并。
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-zinc-200 dark:border-zinc-900 pt-4 mt-auto">
                <button
                  type="button"
                  onClick={() => setStep('upload')}
                  className="h-9.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 px-4 text-xs font-semibold text-zinc-650 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-850 hover:text-zinc-900 dark:hover:text-white transition-all"
                >
                  上一步
                </button>

                <button
                  type="button"
                  onClick={() => setStep('result')}
                  disabled={mergeableBackups.length < 2}
                  className="h-9.5 rounded-lg bg-zinc-950 dark:bg-white text-white dark:text-black px-4.5 text-xs font-bold hover:bg-zinc-850 dark:hover:bg-zinc-200 transition-all disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1.5"
                >
                  确认设置
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </>
          )}

          {step === 'result' && (
            <>
              <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-900 pb-4">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-550 dark:text-zinc-400">导出与合并</h2>
                  <p className="mt-1 text-[11px] text-zinc-450 dark:text-zinc-500">选择保存的目标 ZIP 压缩包路径，并开始合并。</p>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1.5 custom-scrollbar">
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-850 bg-zinc-50 dark:bg-zinc-900/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-300">输出文件路径</h3>
                      <p className="mt-1.5 truncate text-[10px] text-zinc-500 dark:text-zinc-500 font-mono">
                        {outputPath ? outputPath : '尚未选择保存位置'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={chooseOutput}
                      disabled={!desktopApi || Boolean(busy)}
                      className="h-8 shrink-0 rounded-lg border border-zinc-250 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 px-3.5 text-xs font-semibold text-zinc-650 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-white transition-all disabled:opacity-50"
                    >
                      选择位置
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="border border-red-250/20 dark:border-red-950/20 bg-red-50 dark:bg-red-950/10 p-3.5 rounded-xl text-xs leading-relaxed text-red-650 dark:text-red-400 whitespace-pre-wrap">
                    {error}
                  </div>
                )}

                <ProgressPanel progress={progress} busy={busy} />

                {logs.length > 0 && !result && (
                  <div className="border border-zinc-200 dark:border-zinc-900 bg-zinc-50 dark:bg-zinc-950/80 rounded-lg p-3 text-[10px] font-mono text-zinc-650 dark:text-zinc-400 h-28 overflow-y-auto space-y-1 select-text scrollbar-thin shrink-0">
                    {logs.map((log, i) => (
                      <div key={i} className="leading-relaxed break-all">
                        {log}
                      </div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                )}

                {!result && (
                  <button
                    type="button"
                    onClick={merge}
                    disabled={!canMerge}
                    className="h-10 w-full rounded-lg bg-zinc-950 dark:bg-white text-white dark:text-black text-xs font-bold transition-all hover:bg-zinc-850 dark:hover:bg-zinc-200 active:scale-[0.99] disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center"
                  >
                    {busy ?? '确认并开始合并'}
                  </button>
                )}

                {result && (
                  <div className="space-y-4 rounded-xl border border-zinc-200 dark:border-zinc-850 bg-zinc-50 dark:bg-zinc-900/10 p-4">
                    <div>
                      <h3 className="text-xs font-bold text-zinc-850 dark:text-zinc-200 flex items-center gap-1.5">
                        <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        备份合并成功 🎉
                      </h3>
                      <p className="mt-1 text-[10px] font-mono text-zinc-500 dark:text-zinc-500 truncate">已写入 {fmtPath(outputPath)}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <StatTile label="合并话题数" value={result.summary.topicsCount} />
                      <StatTile label="合并消息数" value={result.summary.messagesCount} />
                      <StatTile label="合并助手数" value={result.summary.assistantsCount} />
                      <StatTile label="服务商配置" value={result.summary.providersCount} />
                      <StatTile label="合并智能体" value={result.summary.agentsCount} />
                      <StatTile label="消息数据块" value={result.summary.messageBlocksCount} />
                    </div>

                    {result.warnings.length > 0 && (
                      <div className="space-y-1.5 p-3 rounded bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-900 text-[10px] text-amber-600 dark:text-amber-500/90 leading-relaxed max-h-24 overflow-y-auto font-medium">
                        <p className="font-semibold">警告提示：</p>
                        {result.warnings.map((warning) => (
                          <p key={warning}>· {warning}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-zinc-200 dark:border-zinc-900 pt-4 mt-auto">
                {!result ? (
                  <button
                    type="button"
                    onClick={() => setStep('configure')}
                    disabled={Boolean(busy)}
                    className="h-9.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 px-4 text-xs font-semibold text-zinc-650 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-850 hover:text-zinc-900 dark:hover:text-white transition-all disabled:opacity-50"
                  >
                    上一步
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="h-9.5 rounded-lg border border-zinc-200 dark:border-zinc-850 bg-white dark:bg-zinc-950 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900 hover:text-zinc-850 dark:hover:text-zinc-200 px-4 text-xs font-semibold transition-colors"
                  >
                    合并其他备份
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

