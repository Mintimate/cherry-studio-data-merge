interface Props {
  theme: 'dark' | 'light'
  toggleTheme: () => void
}

export default function Header({ theme, toggleTheme }: Props) {
  return (
    <header
      className="sticky top-0 z-10 border-b border-zinc-200 dark:border-zinc-900 bg-white/85 dark:bg-black/85 backdrop-blur-md select-none"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between pl-16 pr-4 py-3">
        {/* Left side info */}
        <div className="flex items-center gap-3.5" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <div className="flex h-8.5 w-8.5 items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-zinc-800 dark:text-zinc-100">
            <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 18c0-1.7-1.3-3-3-3h-4c-1.7 0-3 1.3-3 3" />
              <path d="M6 6v12" />
              <circle cx="6" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="18" r="3" />
            </svg>
          </div>
          <div>
            <h1 className="text-xs font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 leading-none">
              Cherry Studio 备份合并
            </h1>
            <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">读取本地备份，可视化配置，生成无损合并 ZIP 压缩包</p>
          </div>
        </div>

        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-900/80 transition-all cursor-pointer shrink-0"
          style={{ WebkitAppRegion: 'no-drag' } as any}
          title={theme === 'dark' ? '切换为亮色模式' : '切换为暗色模式'}
        >
          {theme === 'dark' ? (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.364l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>
      </div>
    </header>
  )
}


