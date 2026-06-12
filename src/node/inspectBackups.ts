import { parseBackupFromPath } from './directMerge'
import type { DesktopBackupSummary } from '../types/desktop'

export async function inspectBackupPaths(
  paths: string[],
  onLog?: (msg: string) => void,
): Promise<DesktopBackupSummary[]> {
  return Promise.all(
    paths.map(async (filePath) => {
      const parsed = await parseBackupFromPath(filePath, onLog)


      return {
        id: `backup-${filePath}`,
        path: filePath,
        fileName: parsed.fileName,
        fileSize: parsed.fileSize,
        format: parsed.format,
        version: parsed.version,
        time: parsed.time,
        error: parsed.error,
        stats: parsed.stats,
        status: parsed.data ? 'ready' : 'error',
        zipFiles: parsed.zipFiles,
      }
    }),
  )
}
