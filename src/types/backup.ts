// ─── 底层数据结构 ────────────────────────────────────────────────────────────

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content?: string | unknown[]
  type?: string
  createdAt?: number
  updatedAt?: number
  [key: string]: unknown
}

export interface MessageBlock {
  id: string
  messageId?: string
  type?: string
  content?: unknown
  createdAt?: number
  [key: string]: unknown
}

export interface Topic {
  id: string
  messages?: Message[]
  assistantId?: string
  name?: string
  type?: string
  createdAt?: number
  updatedAt?: number
  lastMessageTime?: number
  [key: string]: unknown
}

export interface Model {
  id: string
  name?: string
  provider?: string
  [key: string]: unknown
}

export interface Provider {
  id: string
  name: string
  type?: string
  apiKey?: string
  apiUrl?: string
  models?: Model[]
  isEnabled?: boolean
  isCustom?: boolean
  createdAt?: number
  updatedAt?: number
  [key: string]: unknown
}

export interface Assistant {
  id: string
  name: string
  avatar?: string
  topics?: unknown[]
  model?: unknown
  systemPrompt?: string
  type?: string
  isDefault?: boolean
  createdAt?: number
  updatedAt?: number
  [key: string]: unknown
}

export interface AgentItem {
  id: string
  name?: string
  emoji?: string
  description?: string
  prompt?: string
  topics?: unknown[]
  createdAt?: number
  updatedAt?: number
  [key: string]: unknown
}

// ─── Redux Persist 状态 ───────────────────────────────────────────────────────

export interface CherryStudioState {
  assistants?: {
    assistants: Assistant[]
    defaultAssistant?: Assistant
    [key: string]: unknown
  }
  settings?: Record<string, unknown>
  llm?: {
    providers: Provider[]
    [key: string]: unknown
  }
  agents?: {
    agents: AgentItem[]
    [key: string]: unknown
  }
  paintings?: unknown
  translate?: unknown
  [key: string]: unknown
}

// ─── 备份文件数据结构 ─────────────────────────────────────────────────────────

export interface BackupData {
  version: number
  time?: number
  localStorage: {
    'persist:cherry-studio'?: string
    [key: string]: string | undefined
  }
  indexedDB: {
    topics?: Topic[]
    settings?: unknown[]
    message_blocks?: MessageBlock[]
    [key: string]: unknown[] | undefined
  }
}

// ─── 解析结果 ─────────────────────────────────────────────────────────────────

export type BackupFormat = 'zip_legacy' | 'bak' | 'json' | 'zip_direct' | 'unknown'

export interface BackupStats {
  topicsCount: number
  messagesCount: number
  assistantsCount: number
  providersCount: number
  agentsCount: number
  messageBlocksCount: number
}

export interface ParsedBackup {
  id: string
  fileName: string
  fileSize: number
  format: BackupFormat
  version: number
  time?: number
  data: BackupData | null
  state?: CherryStudioState
  error?: string
  stats: BackupStats
  /** ZIP 内的文件列表（仅当无法解析时填充，用于诊断） */
  zipFiles?: string[]
}

// ─── 合并选项与结果 ───────────────────────────────────────────────────────────

export type ConflictResolution = 'newer' | 'primary'

export interface MergeOptions {
  conflictResolution: ConflictResolution
  primaryBackupIndex: number
  mergeTopics: boolean
  mergeAssistants: boolean
  mergeProviders: boolean
  mergeAgents: boolean
  settingsSource: number
}

export interface MergeResult {
  data: BackupData
  state: CherryStudioState
  stats: BackupStats
  warnings: string[]
}
