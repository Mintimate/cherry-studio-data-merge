import JSZip from 'jszip'
import pako from 'pako'
import type {
  BackupData,
  BackupFormat,
  BackupStats,
  CherryStudioState,
  ParsedBackup,
  Topic,
} from '../types/backup'

let _idCounter = 0
function generateId(): string {
  return `backup-${Date.now()}-${_idCounter++}`
}

// ─── Redux Persist 反序列化 ───────────────────────────────────────────────────

/**
 * Redux Persist 默认每个 slice 都是 JSON.stringify 过的字符串，
 * 也有版本是直接对象。两种情况都处理。
 */
export function parseReduxPersist(persistStr: string): CherryStudioState | null {
  try {
    const raw = JSON.parse(persistStr) as Record<string, unknown>
    const result: CherryStudioState = {}

    for (const [key, value] of Object.entries(raw)) {
      if (key === '_persist') continue
      if (typeof value === 'string') {
        try {
          result[key] = JSON.parse(value) as unknown
        } catch {
          result[key] = value
        }
      } else {
        result[key] = value
      }
    }

    return result
  } catch {
    return null
  }
}

export function serializeReduxPersist(
  state: CherryStudioState,
  originalStr: string,
): string {
  try {
    const original = JSON.parse(originalStr) as Record<string, unknown>
    const result: Record<string, unknown> = {}

    // 保留 _persist 元数据
    for (const [key, value] of Object.entries(original)) {
      if (key === '_persist') {
        result[key] = value
        continue
      }
      // 如果原始值是字符串说明该 slice 是序列化存储的
      if (typeof value === 'string') {
        result[key] = JSON.stringify(state[key] ?? {})
      } else {
        result[key] = state[key] ?? value
      }
    }

    // 补充 state 中新出现的 key
    for (const key of Object.keys(state)) {
      if (!(key in result)) {
        result[key] = state[key]
      }
    }

    return JSON.stringify(result)
  } catch {
    return JSON.stringify(state)
  }
}

// ─── 统计信息 ─────────────────────────────────────────────────────────────────

function calcStats(data: BackupData, state: CherryStudioState | null): BackupStats {
  const topics: Topic[] = (data.indexedDB?.topics as Topic[] | undefined) ?? []
  const messagesCount = topics.reduce(
    (sum, t) => sum + (Array.isArray(t.messages) ? t.messages.length : 0),
    0,
  )
  return {
    topicsCount: topics.length,
    messagesCount,
    assistantsCount: state?.assistants?.assistants?.length ?? 0,
    providersCount: state?.llm?.providers?.length ?? 0,
    agentsCount: state?.agents?.agents?.length ?? 0,
    messageBlocksCount: data.indexedDB?.message_blocks?.length ?? 0,
  }
}

// ─── 格式检测与解析 ───────────────────────────────────────────────────────────

type ZipScanResult =
  | { kind: 'data'; data: BackupData; format: BackupFormat }
  | { kind: 'direct'; fileNames: string[] }
  | { kind: 'empty'; fileNames: string[] }

/** 一次性扫描 ZIP，返回解析结果或文件列表（避免重复加载） */
async function scanZip(buf: ArrayBuffer): Promise<ZipScanResult | null> {
  try {
    const zip = await JSZip.loadAsync(buf)
    const fileNames = Object.keys(zip.files)

    // 优先找 data.json
    const dataJsonName = fileNames.find((n) => n === 'data.json' || n.endsWith('/data.json'))
    if (dataJsonName) {
      try {
        const text = await zip.file(dataJsonName)!.async('text')
        const parsed = JSON.parse(text) as BackupData
        return { kind: 'data', data: parsed, format: 'zip_legacy' }
      } catch {
        // JSON 解析失败，继续检测
      }
    }

    // 检查是否为直接备份（v6+，含原始数据库目录）
    const isDirect = fileNames.some(
      (n) =>
        n.includes('IndexedDB') ||
        n.toLowerCase().includes('leveldb') ||
        n.includes('Local Storage'),
    )
    if (isDirect) {
      return { kind: 'direct', fileNames }
    }

    // 尝试找任意带 version 字段的 JSON 文件
    for (const name of fileNames) {
      if (!name.endsWith('.json')) continue
      try {
        const text = await zip.file(name)!.async('text')
        const parsed = JSON.parse(text) as BackupData
        if (typeof parsed.version === 'number') {
          return { kind: 'data', data: parsed, format: 'zip_legacy' }
        }
      } catch {
        // continue
      }
    }

    return { kind: 'empty', fileNames }
  } catch {
    return null
  }
}

async function tryParseGzip(buf: ArrayBuffer): Promise<BackupData | null> {
  const u8 = new Uint8Array(buf)
  for (const fn of [pako.inflate, pako.inflateRaw]) {
    try {
      const text = fn(u8, { to: 'string' })
      return JSON.parse(text) as BackupData
    } catch {
      // try next
    }
  }
  return null
}

async function tryParseJson(buf: ArrayBuffer): Promise<BackupData | null> {
  try {
    const text = new TextDecoder().decode(buf)
    return JSON.parse(text) as BackupData
  } catch {
    return null
  }
}

function validateData(data: BackupData): string | null {
  if (!data || typeof data !== 'object') return '备份数据格式无效'
  if (data.version === 1) return 'v1 格式过旧，暂不支持合并'
  if (!data.localStorage && !data.indexedDB) return '缺少必要字段（localStorage / indexedDB）'
  return null
}

// ─── 主入口 ───────────────────────────────────────────────────────────────────

export async function parseBackupFile(file: File): Promise<ParsedBackup> {
  const id = generateId()
  const empty: BackupStats = {
    topicsCount: 0,
    messagesCount: 0,
    assistantsCount: 0,
    providersCount: 0,
    agentsCount: 0,
    messageBlocksCount: 0,
  }

  let buf: ArrayBuffer
  try {
    buf = await file.arrayBuffer()
  } catch {
    return { id, fileName: file.name, fileSize: file.size, format: 'unknown', version: 0, data: null, error: '无法读取文件', stats: empty }
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  let data: BackupData | null = null
  let format: BackupFormat = 'unknown'
  let error: string | undefined

  let zipFiles: string[] | undefined

  if (ext === 'zip') {
    const scanResult = await scanZip(buf)
    if (!scanResult) {
      format = 'unknown'
      error = '无法打开 ZIP 文件，文件可能已损坏。'
    } else if (scanResult.kind === 'data') {
      data = scanResult.data
      format = scanResult.format
    } else if (scanResult.kind === 'direct') {
      format = 'zip_direct'
      zipFiles = scanResult.fileNames.slice(0, 40)
      error =
        '此备份为 Cherry Studio v6+ 直接备份格式（包含原始数据库文件）。\n\n' +
        'Web 端无法直接解析该格式；请在项目目录运行本地命令：\n' +
        'yarn merge:direct <备份1.zip> <备份2.zip> -o merged.zip\n\n' +
        '该命令会在本机启动 Chromium 提取数据，再生成可导入 Cherry Studio 的合并备份。'
    } else {
      format = 'unknown'
      zipFiles = scanResult.fileNames.slice(0, 40)
      error = 'ZIP 文件中未找到可解析的备份数据（data.json）。'
    }
  } else if (ext === 'bak') {
    const gzData = await tryParseGzip(buf)
    if (gzData) {
      data = gzData
      format = 'bak'
    } else {
      const jsonData = await tryParseJson(buf)
      if (jsonData) {
        data = jsonData
        format = 'bak'
      } else {
        error = '无法解析 .bak 文件，可能是不支持的压缩格式。'
      }
    }
  } else if (ext === 'json') {
    const jsonData = await tryParseJson(buf)
    if (jsonData) {
      data = jsonData
      format = 'json'
    } else {
      error = '无法解析 JSON 文件。'
    }
  } else {
    // 未知扩展名，逐一尝试
    const scanResult = await scanZip(buf)
    if (scanResult?.kind === 'data') {
      data = scanResult.data
      format = scanResult.format
    } else {
      const gzData = await tryParseGzip(buf)
      if (gzData) {
        data = gzData
        format = 'bak'
      } else {
        const jsonData = await tryParseJson(buf)
        if (jsonData) {
          data = jsonData
          format = 'json'
        } else {
          error = '无法识别文件格式，请确认文件为 .zip / .bak 备份。'
        }
      }
    }
  }

  // 验证数据结构
  if (data) {
    const validErr = validateData(data)
    if (validErr) {
      error = validErr
      data = null
    } else {
      // 确保 indexedDB 字段存在
      data.indexedDB = data.indexedDB ?? {}
    }
  }

  const state = data?.localStorage?.['persist:cherry-studio']
    ? parseReduxPersist(data.localStorage['persist:cherry-studio'])
    : null

  const stats = data ? calcStats(data, state) : empty

  return {
    id,
    fileName: file.name,
    fileSize: file.size,
    format,
    version: data?.version ?? 0,
    time: data?.time,
    data,
    state: state ?? undefined,
    error,
    stats,
    zipFiles,
  }
}
