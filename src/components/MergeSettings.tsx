import type { MergeOptions } from '../types/backup'
import type { DesktopBackupSummary } from '../types/desktop'

interface Props {
  backups: DesktopBackupSummary[]
  options: MergeOptions
  onOptionsChange: (opts: MergeOptions) => void
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">{children}</h3>
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3.5 cursor-pointer group select-none">
      <div
        onClick={() => onChange(!checked)}
        className={[
          'mt-0.5 relative w-8.5 h-4.5 rounded-full transition-colors duration-200 shrink-0 border',
          checked ? 'bg-zinc-900 border-zinc-900 dark:bg-zinc-100 dark:border-zinc-100' : 'bg-zinc-100 border-zinc-250 dark:bg-zinc-900 dark:border-zinc-800 dark:group-hover:border-zinc-700',
        ].join(' ')}
      >
        <div
          className={[
            'absolute top-[1.5px] left-[1.5px] w-3.5 h-3.5 rounded-full transition-all duration-200 shadow-sm',
            checked ? 'translate-x-3.5 bg-white dark:bg-black' : 'translate-x-0 bg-zinc-400 dark:bg-zinc-500',
          ].join(' ')}
        />
      </div>
      <div>
        <p className="text-xs font-semibold text-zinc-850 dark:text-zinc-200 leading-normal group-hover:text-zinc-950 dark:group-hover:text-white transition-colors">{label}</p>
        {description && <p className="text-[11px] text-zinc-500 mt-1 leading-normal">{description}</p>}
      </div>
    </label>
  )
}

function RadioGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string; desc: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium mb-3">{label}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {options.map((opt) => (
          <label
            key={opt.value}
            className={[
              'group flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-all duration-200 select-none',
              value === opt.value
                ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-200 dark:bg-zinc-900/35'
                : 'border-zinc-200 bg-white dark:border-zinc-800/80 dark:bg-zinc-950/20 hover:border-zinc-300 dark:hover:border-zinc-700/60 dark:hover:bg-zinc-900/10',
            ].join(' ')}
          >
            <div
              className={[
                'mt-0.5 w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 transition-all',
                value === opt.value ? 'border-zinc-900 dark:border-zinc-200' : 'border-zinc-300 dark:border-zinc-800 group-hover:border-zinc-400 dark:group-hover:border-zinc-600',
              ].join(' ')}
              onClick={() => onChange(opt.value)}
            >
              {value === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-zinc-900 dark:bg-zinc-200" />}
            </div>
            <div onClick={() => onChange(opt.value)}>
              <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 group-hover:text-zinc-950 dark:group-hover:text-white transition-colors">{opt.label}</p>
              <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">{opt.desc}</p>
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}

function SelectInput({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: number
  options: { label: string }[]
  onChange: (v: number) => void
}) {
  return (
    <div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium mb-1.5">{label}</p>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg pl-3 pr-8 py-2 text-xs text-zinc-800 dark:text-zinc-200 focus:outline-none focus:border-zinc-450 dark:focus:border-zinc-500 focus:ring-1 focus:ring-zinc-200 dark:focus:ring-zinc-800 transition-all font-medium appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%221.5%22%3E%3Cpath%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[position:right_8px_center] bg-[size:16px_16px] bg-no-repeat cursor-pointer"
      >
        {options.map((opt, i) => (
          <option key={i} value={i} className="bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-250">
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}


export default function MergeSettings({ backups, options, onOptionsChange }: Props) {
  const set = <K extends keyof MergeOptions>(key: K, value: MergeOptions[K]) =>
    onOptionsChange({ ...options, [key]: value })

  const backupOptions = backups.map((b, i) => ({
    label: `#${i + 1} ${b.fileName}`,
  }))

  return (
    <div className="space-y-4">
      {/* 冲突处理策略 */}
      <div className="bg-zinc-50 dark:bg-zinc-900/15 border border-zinc-200 dark:border-zinc-850 rounded-xl p-4">
        <SectionTitle>冲突处理策略</SectionTitle>
        <RadioGroup
          label="当两个备份中存在相同 ID 的数据时："
          value={options.conflictResolution}
          onChange={(v) => set('conflictResolution', v)}
          options={[
            {
              value: 'newer',
              label: '保留最新版本',
              desc: '比较 updatedAt / createdAt 时间戳，保留较新的一条',
            },
            {
              value: 'primary',
              label: '以主备份为准',
              desc: '主备份中的数据优先，其他备份补充缺失部分',
            },
          ]}
        />
      </div>

      {/* 主备份 & 设置来源 */}
      <div className="bg-zinc-50 dark:bg-zinc-900/15 border border-zinc-200 dark:border-zinc-850 rounded-xl p-4 space-y-4">
        <SectionTitle>来源备份</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectInput
            label="主备份 (冲突时优先使用该备份的数据)"
            value={options.primaryBackupIndex}
            options={backupOptions}
            onChange={(v) => set('primaryBackupIndex', v)}
          />
          <SelectInput
            label="应用设置来源 (使用哪个备份的系统设置)"
            value={options.settingsSource}
            options={backupOptions}
            onChange={(v) => set('settingsSource', v)}
          />
        </div>
      </div>

      {/* 合并范围 */}
      <div className="bg-zinc-50 dark:bg-zinc-900/15 border border-zinc-200 dark:border-zinc-850 rounded-xl p-4">
        <SectionTitle>合并范围</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-1">
          <Toggle
            label="合并对话话题"
            description="将所有备份中的聊天记录合并，相同 ID 的话题按策略去重"
            checked={options.mergeTopics}
            onChange={(v) => set('mergeTopics', v)}
          />
          <Toggle
            label="合并自定义助手"
            description="合并来自各备份的自定义 AI 助手"
            checked={options.mergeAssistants}
            onChange={(v) => set('mergeAssistants', v)}
          />
          <Toggle
            label="合并服务商配置"
            description="合并 API Key、模型列表等服务商设置 (API Key 将被保留)"
            checked={options.mergeProviders}
            onChange={(v) => set('mergeProviders', v)}
          />
          <Toggle
            label="合并智能体"
            description="合并自定义智能体 (Agent)"
            checked={options.mergeAgents}
            onChange={(v) => set('mergeAgents', v)}
          />
        </div>
      </div>

      {/* 提示 */}
      <div className="flex items-start gap-3 p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/10 border border-zinc-200 dark:border-zinc-850">
        <svg className="w-4 h-4 text-zinc-500 dark:text-zinc-400 mt-0.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
            clipRule="evenodd"
          />
        </svg>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-normal">
          合并后的备份可通过 Cherry Studio 的「恢复备份」功能导入。
          建议在恢复前先在 Cherry Studio 内手动备份一次当前数据。
        </p>
      </div>
    </div>
  )
}

