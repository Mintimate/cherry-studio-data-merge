import { contextBridge, ipcRenderer } from 'electron'
import type {
  CherryDesktopApi,
  DesktopBackupSummary,
  DesktopMergeRequest,
  DesktopMergeResponse,
  DesktopProgressEvent,
} from '../types/desktop'

const api = {
  selectBackups: () => ipcRenderer.invoke('backups:select') as Promise<DesktopBackupSummary[]>,
  inspectBackups: (paths: string[]) =>
    ipcRenderer.invoke('backups:inspect', paths) as Promise<DesktopBackupSummary[]>,
  mergeBackups: (request: DesktopMergeRequest) =>
    ipcRenderer.invoke('backups:merge', request) as Promise<DesktopMergeResponse>,
  chooseOutputPath: (defaultName: string) =>
    ipcRenderer.invoke('backups:choose-output', defaultName) as Promise<string | null>,
  getSampleBackups: () => ipcRenderer.invoke('backups:samples') as Promise<DesktopBackupSummary[]>,
  onProgress: (handler: (event: DesktopProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: DesktopProgressEvent) => handler(progress)
    ipcRenderer.on('backups:progress', listener)
    return () => ipcRenderer.removeListener('backups:progress', listener)
  },
  setTheme: (theme: 'dark' | 'light') => ipcRenderer.invoke('theme:set', theme) as Promise<void>,
}

contextBridge.exposeInMainWorld('cherryDesktop', api)

const _typecheck: CherryDesktopApi = api
void _typecheck
