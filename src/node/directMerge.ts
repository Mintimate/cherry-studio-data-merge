import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

import JSZip from 'jszip'
import { chromium, type CDPSession, type Page } from 'playwright'

import type {
  BackupData,
  BackupStats,
  CherryStudioState,
  MergeOptions,
  MergeResult,
  ParsedBackup,
  Topic,
} from '../types/backup'
import { parseBackupFile, parseReduxPersist } from '../utils/backupParser'
import { mergeBackups } from '../utils/backupMerger'

interface DirectAssetRef {
  relativePath: string
  zipPath: string
  modifiedAt: number
}

interface MergedAssetRef extends DirectAssetRef {
  sourceZip: JSZip
}

interface DirectParsedBackup extends ParsedBackup {
  sourceZip?: JSZip
  assets?: DirectAssetRef[]
}

interface DumpCandidate {
  origin: string
  localStorage: Record<string, string>
  indexedDB: BackupData['indexedDB']
  score: number
}

interface MergeDirectBackupsOptions {
  inputPaths: string[]
  outputPath: string
  mergeOptions?: Partial<MergeOptions>
  onProgress?: (progress: MergeProgress) => void
}

const DEFAULT_MERGE_OPTIONS: MergeOptions = {
  conflictResolution: 'newer',
  primaryBackupIndex: 0,
  mergeTopics: true,
  mergeAssistants: true,
  mergeProviders: true,
  mergeAgents: true,
  settingsSource: 0,
}

const DIRECT_PROFILE_DIRS = ['IndexedDB', 'Local Storage'] as const

export interface MergeProgress {
  phase: 'reading' | 'merging' | 'writing' | 'done'
  percent: number
  message: string
  detail?: string
  log?: string
}


export async function mergeDirectBackups({
  inputPaths,
  outputPath,
  mergeOptions,
  onProgress,
}: MergeDirectBackupsOptions): Promise<{ result: MergeResult; writtenTo: string }> {
  if (inputPaths.length < 2) {
    throw new Error('至少需要 2 个备份文件')
  }

  onProgress?.({
    phase: 'reading',
    percent: 5,
    message: '正在读取备份',
    detail: `共 ${inputPaths.length} 个文件`,
  })

  const parsed: DirectParsedBackup[] = []
  for (const [index, inputPath] of inputPaths.entries()) {
    const fileName = path.basename(inputPath)
    onProgress?.({
      phase: 'reading',
      percent: 5 + Math.round((index / inputPaths.length) * 35),
      message: `正在解析备份 ${index + 1}/${inputPaths.length}`,
      detail: fileName,
    })
    parsed.push(await parseBackupFromPath(inputPath, (logMsg) => {
      onProgress?.({
        phase: 'reading',
        percent: 5 + Math.round((index / inputPaths.length) * 35),
        message: `正在解析备份 ${index + 1}/${inputPaths.length}`,
        detail: fileName,
        log: logMsg,
      })
    }))
  }

  const options: MergeOptions = { ...DEFAULT_MERGE_OPTIONS, ...mergeOptions }
  onProgress?.({
    phase: 'merging',
    percent: 45,
    message: '正在合并数据',
    detail: '正在合并话题、消息块、助手和设置',
  })
  const result = mergeBackups(parsed, options)
  const assetRefs = mergeAssetRefs(parsed, options)
  const buffer = await createMergedDirectBackupZip(parsed, result, assetRefs, options, (zipPercent) => {
    onProgress?.({
      phase: 'writing',
      percent: 50 + Math.round(zipPercent * 0.48),
      message: '正在写入直接备份 ZIP',
      detail: `${assetRefs.length.toLocaleString()} 个附件`,
    })
  })

  await writeFile(outputPath, buffer)
  onProgress?.({
    phase: 'done',
    percent: 100,
    message: '合并完成',
    detail: outputPath,
  })
  return { result, writtenTo: outputPath }
}

export async function parseBackupFromPath(
  filePath: string,
  onLog?: (msg: string) => void,
): Promise<DirectParsedBackup> {
  const fileName = path.basename(filePath)
  onLog?.(`[${fileName}] 开始读取文件数据...`)
  const buffer = await readFile(filePath)
  const file = new File([buffer], fileName, {
    type: 'application/zip',
    lastModified: Date.now(),
  })

  onLog?.(`[${fileName}] 正在解析基础文件格式与元数据...`)
  const parsed = await parseBackupFile(file)
  if (parsed.format !== 'zip_direct') {
    onLog?.(`[${fileName}] 识别为普通格式备份: ${parsed.format}`)
    return parsed
  }

  onLog?.(`[${fileName}] 识别为 Chromium 直接备份，准备启动解析容器...`)
  return extractDirectBackup(filePath, buffer, parsed, onLog)
}

async function extractDirectBackup(
  filePath: string,
  buffer: Buffer,
  parsed: ParsedBackup,
  onLog?: (msg: string) => void,
): Promise<DirectParsedBackup> {
  const fileName = path.basename(filePath)
  onLog?.(`[${fileName}] 正在加载 ZIP 归档...`)
  const zip = await JSZip.loadAsync(buffer)
  const fileNames = Object.keys(zip.files)
  
  onLog?.(`[${fileName}] 正在创建临时 Profile 沙盒目录...`)
  const profileRoot = await mkdtemp(path.join(tmpdir(), 'cherry-direct-profile-'))
  const cleanupTargets = [profileRoot]

  try {
    onLog?.(`[${fileName}] 正在解压 Chromium 用户配置文件 (Local Storage / IndexedDB)...`)
    await materializeChromiumProfile(zip, profileRoot)
    const origins = deriveOrigins(fileNames)
    
    onLog?.(`[${fileName}] 启动 Playwright 无头浏览器以读取 IndexedDB 数据...`)
    const candidate = await dumpBestCandidate(profileRoot, origins, onLog, fileName)

    if (!candidate) {
      throw new Error(
        `未能从 ${path.basename(filePath)} 中恢复 IndexedDB / Local Storage 数据，请确认备份未损坏。`,
      )
    }

    const data: BackupData = {
      version: 6,
      time: (await readMetadataTimestamp(zip)) ?? Date.now(),
      localStorage: candidate.localStorage,
      indexedDB: candidate.indexedDB,
    }
    const state =
      candidate.localStorage['persist:cherry-studio']
        ? parseReduxPersist(candidate.localStorage['persist:cherry-studio']) ?? undefined
        : undefined

    return {
      ...parsed,
      format: 'zip_direct',
      version: 6,
      time: data.time,
      data,
      state,
      error: undefined,
      stats: calcStats(data, state ?? null),
      sourceZip: zip,
      assets: listDataAssets(zip),
      zipFiles: fileNames.slice(0, 40),
    }
  } finally {
    await Promise.all(cleanupTargets.map((dir) => rm(dir, { recursive: true, force: true })))
  }
}

async function materializeChromiumProfile(zip: JSZip, profileRoot: string): Promise<void> {
  const defaultProfileRoot = path.join(profileRoot, 'Default')

  for (const dir of DIRECT_PROFILE_DIRS) {
    await mkdir(path.join(profileRoot, dir), { recursive: true })
    await mkdir(path.join(defaultProfileRoot, dir), { recursive: true })
  }

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    const topLevel = name.split('/')[0]
    if (!DIRECT_PROFILE_DIRS.includes(topLevel as (typeof DIRECT_PROFILE_DIRS)[number])) {
      continue
    }

    const bytes = await entry.async('uint8array')
    const targets = [path.join(profileRoot, name), path.join(defaultProfileRoot, name)]
    for (const target of targets) {
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, bytes)
    }
  }
}

function deriveOrigins(fileNames: string[]): string[] {
  const origins = new Set<string>()

  for (const name of fileNames) {
    if (!name.startsWith('IndexedDB/')) continue
    const segment = name.slice('IndexedDB/'.length).split('/')[0]
    if (!segment.endsWith('.indexeddb.leveldb')) continue

    const origin = decodeIndexedDbDirOrigin(segment)
    if (origin) origins.add(origin)
  }

  if (origins.size === 0) {
    origins.add('file://')
  }

  return Array.from(origins)
}

function decodeIndexedDbDirOrigin(dirName: string): string | null {
  const match = dirName.match(/^([a-z]+)_(.*)_([0-9]+)\.indexeddb\.leveldb$/i)
  if (!match) return null

  const [, rawScheme, rawHost, rawPort] = match
  const scheme = rawScheme.toLowerCase()
  if (scheme === 'file') return 'file://'

  const host = rawHost
  const port = Number(rawPort)
  if (!host) return null
  return port > 0 ? `${scheme}://${host}:${port}` : `${scheme}://${host}`
}

async function dumpBestCandidate(
  profileRoot: string,
  origins: string[],
  onLog?: (msg: string) => void,
  fileName?: string,
): Promise<DumpCandidate | null> {
  onLog?.(`[${fileName}] 启动 Headless Chromium 并挂载临时沙盒...`)
  const context = await chromium.launchPersistentContext(profileRoot, {
    headless: true,
  })

  try {
    const page = context.pages()[0] ?? (await context.newPage())
    onLog?.(`[${fileName}] 正在建立 Chrome DevTools Protocol 调试连接...`)
    const session = await context.newCDPSession(page)
    await session.send('Runtime.enable')
    await session.send('IndexedDB.enable')
    await session.send('DOMStorage.enable')

    const candidates: DumpCandidate[] = []
    for (const origin of origins) {
      onLog?.(`[${fileName}] 正在同步安全源: ${origin}...`)
      await preparePageForOrigin(page, profileRoot, origin)
      const dump = await dumpOrigin(session, origin, onLog, fileName)
      if (!dump) continue
      candidates.push(dump)
    }

    candidates.sort((a, b) => b.score - a.score)
    return candidates[0] ?? null
  } finally {
    onLog?.(`[${fileName}] 正在关闭 Chromium 进程并销毁 CDP 连接...`)
    await context.close()
  }
}

async function preparePageForOrigin(page: Page, profileRoot: string, origin: string): Promise<void> {
  try {
    if (origin === 'file://') {
      const probePath = path.join(profileRoot, 'cherry-studio-probe.html')
      await writeFile(probePath, '<!doctype html><meta charset="utf-8"><title>probe</title>')
      await page.goto(pathToFileURL(probePath).href)
      return
    }

    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 5_000 })
  } catch {
    // The document only needs to establish the origin for CDP storage calls.
  }
}

async function dumpOrigin(
  session: CDPSession,
  origin: string,
  onLog?: (msg: string) => void,
  fileName?: string,
): Promise<DumpCandidate | null> {
  const localStorage = await readLocalStorage(session, origin)
  const databaseNamesResponse = (await session.send('IndexedDB.requestDatabaseNames', {
    securityOrigin: origin,
  })) as { databaseNames?: string[] }
  const databaseNames = databaseNamesResponse.databaseNames ?? []

  if (Object.keys(localStorage).length === 0 && databaseNames.length === 0) {
    return null
  }

  const indexedDB: BackupData['indexedDB'] = {}
  let totalRows = 0

  for (const databaseName of databaseNames) {
    onLog?.(`[${fileName}] 发现数据库 [${databaseName}]，开始拉取表结构...`)
    const databaseResponse = (await session.send('IndexedDB.requestDatabase', {
      securityOrigin: origin,
      databaseName,
    })) as {
      databaseWithObjectStores?: {
        objectStores?: Array<{ name: string }>
      }
    }

    const objectStores = databaseResponse.databaseWithObjectStores?.objectStores ?? []
    for (const store of objectStores) {
      onLog?.(`[${fileName}] 正在读取数据表 [${databaseName}.${store.name}]...`)
      const rows = await readObjectStoreValues(session, origin, databaseName, store.name)
      if (rows.length === 0) continue
      indexedDB[store.name] = rows as unknown[]
      totalRows += rows.length
    }
  }

  const hasPersist = typeof localStorage['persist:cherry-studio'] === 'string'
  const topicRows = Array.isArray(indexedDB.topics) ? indexedDB.topics.length : 0

  return {
    origin,
    localStorage,
    indexedDB,
    score: (hasPersist ? 10_000 : 0) + topicRows * 10 + totalRows,
  }
}

async function readLocalStorage(
  session: CDPSession,
  origin: string,
): Promise<Record<string, string>> {
  try {
    const response = (await session.send('DOMStorage.getDOMStorageItems', {
      storageId: {
        securityOrigin: origin,
        isLocalStorage: true,
      },
    })) as { entries?: Array<[string, string]> }

    return Object.fromEntries(response.entries ?? [])
  } catch {
    return {}
  }
}

async function readObjectStoreValues(
  session: CDPSession,
  origin: string,
  databaseName: string,
  objectStoreName: string,
): Promise<unknown[]> {
  const values: unknown[] = []
  let skipCount = 0

  while (true) {
    const response = (await session.send('IndexedDB.requestData', {
      securityOrigin: origin,
      databaseName,
      objectStoreName,
      skipCount,
      pageSize: 200,
    })) as unknown as {
      objectStoreDataEntries?: Array<{ value: Record<string, unknown> }>
      hasMore?: boolean
    }

    const entries = response.objectStoreDataEntries ?? []
    if (entries.length === 0) break

    for (const entry of entries) {
      values.push(await materializeRemoteValue(session, entry.value))
    }

    skipCount += entries.length
    if (!response.hasMore) break
  }

  return values
}

async function materializeRemoteValue(
  session: CDPSession,
  remoteObject: Record<string, unknown>,
): Promise<unknown> {
  const objectId = typeof remoteObject.objectId === 'string' ? remoteObject.objectId : undefined
  if (!objectId) {
    if ('value' in remoteObject) return remoteObject.value
    if (typeof remoteObject.unserializableValue === 'string') {
      return parseUnserializableValue(remoteObject.unserializableValue)
    }
    return remoteObject.description ?? null
  }

  try {
    const response = (await session.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration:
        'function () { try { return JSON.stringify(this) } catch { return null } }',
      returnByValue: true,
      silent: true,
    })) as { result?: { value?: string | null } }

    const json = response.result?.value
    return typeof json === 'string' ? JSON.parse(json) : null
  } finally {
    await session.send('Runtime.releaseObject', { objectId }).catch(() => undefined)
  }
}

function parseUnserializableValue(value: string): unknown {
  switch (value) {
    case '-0':
      return -0
    case 'NaN':
      return Number.NaN
    case 'Infinity':
      return Number.POSITIVE_INFINITY
    case '-Infinity':
      return Number.NEGATIVE_INFINITY
    default:
      return value.endsWith('n') ? Number(value.slice(0, -1)) : value
  }
}

async function readMetadataTimestamp(zip: JSZip): Promise<number | undefined> {
  const entry = zip.file('metadata.json')
  if (!entry) return undefined
  try {
    const text = await entry.async('text')
    const metadata = JSON.parse(text) as { timestamp?: number }
    return typeof metadata.timestamp === 'number' ? metadata.timestamp : undefined
  } catch {
    return undefined
  }
}

function listDataAssets(zip: JSZip): DirectAssetRef[] {
  return Object.entries(zip.files)
    .filter(([name, entry]) => !entry.dir && name.startsWith('Data/'))
    .map(([name, entry]) => ({
      relativePath: name,
      zipPath: name,
      modifiedAt: entry.date.getTime(),
    }))
}

function mergeAssetRefs(backups: DirectParsedBackup[], options: MergeOptions): MergedAssetRef[] {
  const merged = new Map<string, MergedAssetRef>()

  for (const [sourceIndex, backup] of backups.entries()) {
    const sourceZip = backup.sourceZip
    if (!sourceZip || !backup.assets) continue

    for (const ref of backup.assets) {
      const next: MergedAssetRef = { ...ref, sourceZip }
      const existing = merged.get(ref.relativePath)
      if (!existing) {
        merged.set(ref.relativePath, next)
        continue
      }

      const shouldReplace =
        options.conflictResolution === 'primary'
          ? sourceIndex === options.primaryBackupIndex
          : ref.modifiedAt > existing.modifiedAt

      if (shouldReplace) {
        merged.set(ref.relativePath, next)
      }
    }
  }

  return Array.from(merged.values())
}

async function createMergedDirectBackupZip(
  backups: DirectParsedBackup[],
  result: MergeResult,
  assets: MergedAssetRef[],
  options: MergeOptions,
  onProgress?: (percent: number) => void,
): Promise<Buffer> {
  const primary = backups[Math.min(options.primaryBackupIndex, backups.length - 1)] ?? backups[0]
  if (!primary.sourceZip) {
    return createLegacyMergedNodeZip(result, assets, onProgress)
  }

  const profileRoot = await mkdtemp(path.join(tmpdir(), 'cherry-direct-output-'))
  try {
    await materializeChromiumProfile(primary.sourceZip, profileRoot)
    await writeMergedDataToProfile(profileRoot, result.data)
    return await createProfileZip(profileRoot, primary.sourceZip, assets, onProgress)
  } finally {
    await rm(profileRoot, { recursive: true, force: true })
  }
}

async function writeMergedDataToProfile(profileRoot: string, data: BackupData): Promise<void> {
  const context = await chromium.launchPersistentContext(profileRoot, {
    headless: true,
  })

  try {
    const page = context.pages()[0] ?? (await context.newPage())
    await preparePageForOrigin(page, profileRoot, 'file://')
    await page.evaluate(async (backupData) => {
      localStorage.clear()
      for (const [key, value] of Object.entries(backupData.localStorage ?? {})) {
        if (typeof value === 'string') localStorage.setItem(key, value)
      }

      const databases =
        typeof indexedDB.databases === 'function'
          ? await indexedDB.databases()
          : [{ name: 'cherry-studio' }]

      let targetDatabaseName: string | undefined
      for (const database of databases) {
        if (!database.name) continue
        const db = await new Promise<IDBDatabase | null>((resolve) => {
          const request = indexedDB.open(database.name!)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve(null)
        })
        if (!db) continue
        const storeNames = Array.from(db.objectStoreNames)
        db.close()
        if (storeNames.includes('topics') || storeNames.includes('message_blocks')) {
          targetDatabaseName = database.name
          break
        }
      }

      if (!targetDatabaseName) {
        throw new Error('未找到 Cherry Studio IndexedDB 数据库。')
      }

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(targetDatabaseName!)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('无法打开 IndexedDB'))
      })

      try {
        const requestedStores = Object.keys(backupData.indexedDB ?? {})
        const stores = requestedStores.filter((store) => db.objectStoreNames.contains(store))
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(stores, 'readwrite')
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error ?? new Error('写入 IndexedDB 失败'))
          tx.onabort = () => reject(tx.error ?? new Error('写入 IndexedDB 已中止'))

          for (const storeName of stores) {
            const store = tx.objectStore(storeName)
            store.clear()
            for (const row of backupData.indexedDB?.[storeName] ?? []) {
              store.put(row)
            }
          }
        })
      } finally {
        db.close()
      }
    }, data)
  } finally {
    await context.close()
  }
}

async function createProfileZip(
  profileRoot: string,
  primaryZip: JSZip,
  assets: MergedAssetRef[],
  onProgress?: (percent: number) => void,
): Promise<Buffer> {
  const zip = new JSZip()
  const profileSourceRoot = profileRoot

  await addDirectoryToZip(zip, path.join(profileSourceRoot, 'IndexedDB'), 'IndexedDB')
  await addDirectoryToZip(zip, path.join(profileSourceRoot, 'Local Storage'), 'Local Storage')

  const metadata = await createMergedMetadata(primaryZip)
  zip.file('metadata.json', JSON.stringify(metadata, null, 2))

  for (const asset of assets) {
    const entry = asset.sourceZip.file(asset.zipPath)
    if (!entry) continue
    zip.file(asset.relativePath, await entry.async('uint8array'), {
      date: new Date(asset.modifiedAt),
    })
  }

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  }, (metadata) => {
    onProgress?.(metadata.percent)
  })
}

async function addDirectoryToZip(zip: JSZip, sourceDir: string, zipDir: string): Promise<void> {
  let entries
  try {
    entries = await readdir(sourceDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name)
    const zipPath = `${zipDir}/${entry.name}`
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, sourcePath, zipPath)
    } else if (entry.isFile()) {
      try {
        const fileStat = await stat(sourcePath)
        zip.file(zipPath, await readFile(sourcePath), {
          date: fileStat.mtime,
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
}

async function createMergedMetadata(primaryZip: JSZip): Promise<Record<string, unknown>> {
  const entry = primaryZip.file('metadata.json')
  if (!entry) {
    return {
      version: 6,
      timestamp: Date.now(),
      appName: 'Cherry Studio',
    }
  }

  try {
    const metadata = JSON.parse(await entry.async('text')) as Record<string, unknown>
    return {
      ...metadata,
      timestamp: Date.now(),
    }
  } catch {
    return {
      version: 6,
      timestamp: Date.now(),
      appName: 'Cherry Studio',
    }
  }
}

async function createLegacyMergedNodeZip(
  result: MergeResult,
  assets: MergedAssetRef[],
  onProgress?: (percent: number) => void,
): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('data.json', JSON.stringify(result.data))

  for (const asset of assets) {
    const entry = asset.sourceZip.file(asset.zipPath)
    if (!entry) continue
    zip.file(asset.relativePath, await entry.async('uint8array'), {
      date: new Date(asset.modifiedAt),
    })
  }

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  }, (metadata) => {
    onProgress?.(metadata.percent)
  })
}

function calcStats(data: BackupData, state: CherryStudioState | null): BackupStats {
  const topics: Topic[] = (data.indexedDB?.topics as Topic[] | undefined) ?? []
  const messagesCount = topics.reduce(
    (sum, topic) => sum + (Array.isArray(topic.messages) ? topic.messages.length : 0),
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

export function formatMergeSummary(result: MergeResult): string {
  const { stats } = result
  return [
    `话题: ${stats.topicsCount}`,
    `消息: ${stats.messagesCount}`,
    `助手: ${stats.assistantsCount}`,
    `服务商: ${stats.providersCount}`,
    `智能体: ${stats.agentsCount}`,
    `消息块: ${stats.messageBlocksCount}`,
  ].join(' | ')
}
