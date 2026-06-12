import type { BackupFormat, BackupStats, MergeOptions } from './backup'

export type DesktopBackupStatus = 'selected' | 'analyzing' | 'ready' | 'error'

export interface DesktopBackupSummary {
  id: string
  path: string
  fileName: string
  fileSize: number
  format: BackupFormat
  version: number
  time?: number
  error?: string
  stats?: BackupStats
  status: DesktopBackupStatus
  zipFiles?: string[]
}

export interface DesktopMergeRequest {
  inputPaths: string[]
  outputPath: string
  options: MergeOptions
}

export interface DesktopMergeResponse {
  outputPath: string
  summary: BackupStats
  warnings: string[]
}

export interface DesktopProgressEvent {
  phase: 'idle' | 'selecting' | 'analyzing' | 'reading' | 'merging' | 'writing' | 'done' | 'error'
  percent: number
  message: string
  detail?: string
  log?: string
}


export interface CherryDesktopApi {
  selectBackups: () => Promise<DesktopBackupSummary[]>
  inspectBackups: (paths: string[]) => Promise<DesktopBackupSummary[]>
  mergeBackups: (request: DesktopMergeRequest) => Promise<DesktopMergeResponse>
  chooseOutputPath: (defaultName: string) => Promise<string | null>
  getSampleBackups: () => Promise<DesktopBackupSummary[]>
  onProgress: (handler: (event: DesktopProgressEvent) => void) => () => void
  setTheme: (theme: 'dark' | 'light') => Promise<void>
}
