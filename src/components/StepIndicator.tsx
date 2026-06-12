type Step = 'upload' | 'configure' | 'result'

const STEPS: { key: Step; label: string }[] = [
  { key: 'upload', label: '载入备份' },
  { key: 'configure', label: '合并配置' },
  { key: 'result', label: '合并导出' },
]

interface Props {
  step: Step
}

export default function StepIndicator({ step }: Props) {
  const currentIndex = STEPS.findIndex((s) => s.key === step)

  return (
    <div className="flex items-center justify-between w-full max-w-xl mx-auto px-4 py-2 select-none">
      {STEPS.map((s, i) => {
        const done = i < currentIndex
        const active = i === currentIndex
        return (
          <div key={s.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex items-center gap-2.5">
              <div
                className={[
                  'w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-300 border',
                  done
                    ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black border-zinc-900 dark:border-zinc-100'
                    : active
                      ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white ring-4 ring-black/10 dark:ring-white/10'
                      : 'bg-zinc-100 dark:bg-zinc-950 text-zinc-400 dark:text-zinc-500 border-zinc-200 dark:border-zinc-800/80',
                ].join(' ')}
              >
                {done ? (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={[
                  'text-xs font-semibold tracking-tight whitespace-nowrap transition-colors duration-300',
                  active ? 'text-zinc-900 dark:text-zinc-100' : done ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-400 dark:text-zinc-500',
                ].join(' ')}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={[
                  'flex-1 h-[1px] mx-4 transition-colors duration-300',
                  i < currentIndex ? 'bg-zinc-300 dark:bg-zinc-700' : 'bg-zinc-200 dark:bg-zinc-900',
                ].join(' ')}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

