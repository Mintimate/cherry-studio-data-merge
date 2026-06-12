import JSZip from 'jszip'
import type {
  Assistant,
  AgentItem,
  BackupData,
  CherryStudioState,
  MergeOptions,
  MergeResult,
  MessageBlock,
  ParsedBackup,
  Provider,
  Topic,
} from '../types/backup'
import { parseReduxPersist, serializeReduxPersist } from './backupParser'

const RESTORABLE_INDEXEDDB_TABLES = new Set([
  'topics',
  'message_blocks',
  'settings',
  'files',
  'knowledge_notes',
  'favorites',
  'keyvalue',
  'emoji',
])


// ─── 泛型去重合并 ─────────────────────────────────────────────────────────────

type WithId = { id: string; updatedAt?: number; createdAt?: number; lastMessageTime?: number }

function mergeById<T extends WithId>(
  arrays: T[][],
  conflictResolution: 'newer' | 'primary',
  primaryIndex: number,
): T[] {
  const map = new Map<string, T>()

  if (conflictResolution === 'primary') {
    // 先放非 primary 的，再用 primary 覆盖
    arrays.forEach((arr, idx) => {
      if (idx !== primaryIndex) {
        arr.forEach((item) => {
          if (!map.has(item.id)) map.set(item.id, item)
        })
      }
    })
    const primary = arrays[primaryIndex] ?? []
    primary.forEach((item) => map.set(item.id, item))
  } else {
    // newer wins —— 用时间戳比较
    arrays.forEach((arr) => {
      arr.forEach((item) => {
        const existing = map.get(item.id)
        if (!existing) {
          map.set(item.id, item)
        } else {
          const t = item.updatedAt ?? item.createdAt ?? item.lastMessageTime ?? 0
          const et = existing.updatedAt ?? existing.createdAt ?? existing.lastMessageTime ?? 0
          if (t > et) map.set(item.id, item)
        }
      })
    })
  }

  return Array.from(map.values())
}

function mergeTopicsDeep(
  arrays: Topic[][],
  conflictResolution: 'newer' | 'primary',
  primaryIndex: number,
): Topic[] {
  const mergedTopics = mergeById(arrays, conflictResolution, primaryIndex)

  const messagesByTopicId = new Map<string, import('../types/backup').Message[]>()
  for (const arr of arrays) {
    for (const topic of arr) {
      if (Array.isArray(topic.messages) && topic.messages.length > 0) {
        const existing = messagesByTopicId.get(topic.id) || []
        messagesByTopicId.set(topic.id, existing.concat(topic.messages))
      }
    }
  }

  for (const topic of mergedTopics) {
    const allMessages = messagesByTopicId.get(topic.id)
    if (allMessages && allMessages.length > 0) {
      topic.messages = mergeById([allMessages], 'newer', 0).sort(
        (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
      )
    }
  }

  return mergedTopics
}

function mergeProvidersDeep(
  arrays: Provider[][],
  conflictResolution: 'newer' | 'primary',
  primaryIndex: number,
): Provider[] {
  const mergedProviders = mergeById(arrays, conflictResolution, primaryIndex)

  const modelsByProviderId = new Map<string, import('../types/backup').Model[]>()
  for (const arr of arrays) {
    for (const provider of arr) {
      if (Array.isArray(provider.models) && provider.models.length > 0) {
        const existing = modelsByProviderId.get(provider.id) || []
        modelsByProviderId.set(provider.id, existing.concat(provider.models))
      }
    }
  }

  for (const provider of mergedProviders) {
    const allModels = modelsByProviderId.get(provider.id)
    if (allModels && allModels.length > 0) {
      provider.models = mergeById([allModels], 'newer', 0)
    }
  }

  return mergedProviders
}

// ─── IndexedDB 表合并 ─────────────────────────────────────────────────────────

function mergeIndexedDB(
  backups: ParsedBackup[],
  options: MergeOptions,
): { indexedDB: BackupData['indexedDB']; warnings: string[] } {
  const primaryData = backups[options.primaryBackupIndex]?.data ?? backups[0].data!
  const result: BackupData['indexedDB'] = {}
  const warnings: string[] = []

  // 收集所有表名
  const allTables = new Set<string>()
  backups.forEach((b) => Object.keys(b.data?.indexedDB ?? {}).forEach((t) => allTables.add(t)))

  for (const table of allTables) {
    if (!RESTORABLE_INDEXEDDB_TABLES.has(table)) {
      warnings.push(`已跳过 IndexedDB 表「${table}」，避免 Cherry Studio 恢复时出现表不存在错误。`)
      continue
    }

    if (table === 'topics') {
      if (!options.mergeTopics) {
        result.topics = primaryData.indexedDB?.topics ?? []
        continue
      }
      const arrays = backups.map((b) => (b.data?.indexedDB?.topics ?? []) as Topic[])
      result.topics = mergeTopicsDeep(arrays, options.conflictResolution, options.primaryBackupIndex)
    } else if (table === 'message_blocks') {
      const arrays = backups.map((b) => (b.data?.indexedDB?.message_blocks ?? []) as MessageBlock[])
      result.message_blocks = mergeById(arrays, options.conflictResolution, options.primaryBackupIndex)
    } else if (table === 'settings') {
      // settings 表始终取 primary
      result.settings = primaryData.indexedDB?.settings ?? []
    } else {
      // 未知表：尝试按 id 去重，否则取 primary
      const arrays = backups.map((b) => (b.data?.indexedDB?.[table] ?? []) as unknown[])
      const flat = arrays.flat()
      if (flat.length > 0 && flat[0] && typeof flat[0] === 'object' && 'id' in (flat[0] as object)) {
        result[table] = mergeById(
          arrays as WithId[][],
          options.conflictResolution,
          options.primaryBackupIndex,
        ) as unknown[]
      } else {
        result[table] = primaryData.indexedDB?.[table] ?? []
      }
    }
  }

  return { indexedDB: result, warnings }
}

function hydrateMessageContent(indexedDB: BackupData['indexedDB']): void {
  const topics = (indexedDB.topics ?? []) as Topic[]
  const blocks = (indexedDB.message_blocks ?? []) as MessageBlock[]
  if (topics.length === 0 || blocks.length === 0) return

  const blocksByMessage = new Map<string, MessageBlock[]>()
  for (const block of blocks) {
    if (!block.messageId) continue
    const existing = blocksByMessage.get(block.messageId) ?? []
    existing.push(block)
    blocksByMessage.set(block.messageId, existing)
  }

  for (const topic of topics) {
    if (!Array.isArray(topic.messages)) continue
    for (const message of topic.messages) {
      if (message.content !== undefined) continue
      const messageBlocks = blocksByMessage.get(message.id) ?? []
      const text = messageBlocks
        .filter((block) => block.type === 'main_text' && typeof block.content === 'string')
        .map((block) => block.content as string)
        .join('\n\n')
        .trim()
      if (text) message.content = text
    }
  }
}

// ─── Redux State 合并 ─────────────────────────────────────────────────────────

function mergeReduxState(
  backups: ParsedBackup[],
  options: MergeOptions,
): { state: CherryStudioState; warnings: string[] } {
  const warnings: string[] = []
  const states = backups.map((b) => {
    if (b.state) return b.state
    if (b.data?.localStorage?.['persist:cherry-studio']) {
      return parseReduxPersist(b.data.localStorage['persist:cherry-studio'])
    }
    return null
  })

  const primaryState = states[options.primaryBackupIndex] ?? states.find(Boolean) ?? {}
  const merged: CherryStudioState = { ...primaryState }

  // assistants
  if (options.mergeAssistants) {
    const arrays = states.map((s) => (s?.assistants?.assistants ?? []) as Assistant[])
    const mergedAssistants = mergeById(arrays, options.conflictResolution, options.primaryBackupIndex)
    merged.assistants = { ...(merged.assistants ?? {}), assistants: mergedAssistants }
  }

  // providers / llm
  if (options.mergeProviders) {
    const arrays = states.map((s) => (s?.llm?.providers ?? []) as Provider[])
    const mergedProviders = mergeProvidersDeep(arrays, options.conflictResolution, options.primaryBackupIndex)
    // 检查是否存在重名但 id 不同的 provider
    const nameSet = new Set<string>()
    for (const p of mergedProviders) {
      if (nameSet.has(p.name)) {
        warnings.push(`服务商「${p.name}」在多个备份中均有定义，已按${options.conflictResolution === 'newer' ? '最新修改时间' : '主备份'}保留。`)
      }
      nameSet.add(p.name)
    }
    merged.llm = { ...(merged.llm ?? {}), providers: mergedProviders }
  }

  // agents
  if (options.mergeAgents) {
    const arrays = states.map((s) => (s?.agents?.agents ?? []) as AgentItem[])
    merged.agents = {
      ...(merged.agents ?? {}),
      agents: mergeById(arrays, options.conflictResolution, options.primaryBackupIndex),
    }
  }

  // settings — 从指定备份取
  const settingsSrc = Math.min(options.settingsSource, backups.length - 1)
  if (states[settingsSrc]?.settings) {
    merged.settings = states[settingsSrc]!.settings
  }

  return { state: merged, warnings }
}

// ─── 主合并函数 ───────────────────────────────────────────────────────────────

export function mergeBackups(allBackups: ParsedBackup[], options: MergeOptions): MergeResult {
  const backups = allBackups.filter((b) => b.data !== null)
  if (backups.length < 2) throw new Error('至少需要 2 个有效的备份文件才能合并')

  const primaryBackup = backups[Math.min(options.primaryBackupIndex, backups.length - 1)]
  const primaryData = primaryBackup.data!

  const { state: mergedState, warnings } = mergeReduxState(backups, options)
  const { indexedDB: mergedIndexedDB, warnings: indexedDBWarnings } = mergeIndexedDB(backups, options)
  hydrateMessageContent(mergedIndexedDB)

  // 重建 localStorage（保持原始序列化格式）
  const origPersist = primaryData.localStorage?.['persist:cherry-studio'] ?? '{}'
  const mergedPersist = serializeReduxPersist(mergedState, origPersist)

  const maxVersion = Math.max(...backups.map((b) => b.version), 5)

  const mergedData: BackupData = {
    version: maxVersion,
    time: Date.now(),
    localStorage: {
      'persist:cherry-studio': mergedPersist,
    },
    indexedDB: mergedIndexedDB,
  }


  const topics = (mergedIndexedDB.topics ?? []) as Topic[]
  const messagesCount = topics.reduce(
    (sum, t) => sum + (Array.isArray(t.messages) ? t.messages.length : 0),
    0,
  )

  return {
    data: mergedData,
    state: mergedState,
    stats: {
      topicsCount: topics.length,
      messagesCount,
      assistantsCount: mergedState.assistants?.assistants?.length ?? 0,
      providersCount: mergedState.llm?.providers?.length ?? 0,
      agentsCount: mergedState.agents?.agents?.length ?? 0,
      messageBlocksCount: (mergedIndexedDB.message_blocks ?? []).length,
    },
    warnings: [...warnings, ...indexedDBWarnings],
  }
}

// ─── 生成下载 ZIP ─────────────────────────────────────────────────────────────

export async function createMergedZip(result: MergeResult): Promise<Blob> {
  const zip = new JSZip()
  zip.file('data.json', JSON.stringify(result.data))
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}
