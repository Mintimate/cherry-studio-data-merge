import { app, BrowserWindow, dialog, ipcMain, nativeTheme, type WebContents } from 'electron'
import { readdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { DesktopBackupSummary, DesktopMergeRequest, DesktopProgressEvent } from '../types/desktop'
import { mergeDirectBackups } from '../node/directMerge'
import { inspectBackupPaths } from '../node/inspectBackups'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

function createWindow() {
  const isDark = nativeTheme.shouldUseDarkColors
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    title: 'Cherry Studio Backup Merge',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    titleBarOverlay: process.platform === 'win32' ? {
      color: isDark ? '#030303' : '#ffffff',
      symbolColor: isDark ? '#f4f4f5' : '#18181b',
      height: 36,
    } : false,
    backgroundColor: isDark ? '#030303' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })


  if (isDev) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL!)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function registerIpc() {
  ipcMain.handle('theme:set', (_event, theme: 'dark' | 'light') => {
    nativeTheme.themeSource = theme
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.setBackgroundColor(theme === 'dark' ? '#030303' : '#ffffff')
      if (process.platform === 'win32') {
        win.setTitleBarOverlay({
          color: theme === 'dark' ? '#030303' : '#ffffff',
          symbolColor: theme === 'dark' ? '#f4f4f5' : '#18181b',
          height: 36,
        })
      }
    }
  })

  ipcMain.handle('backups:samples', () => createSelectedBackupSummaries(findSampleBackups()))

  ipcMain.handle('backups:select', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 Cherry Studio 备份',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Cherry Studio Backup', extensions: ['zip', 'bak', 'json'] }],
    })
    if (result.canceled) return []
    return createSelectedBackupSummaries(result.filePaths)
  })

  ipcMain.handle('backups:inspect', async (event, paths: string[]) => {
    sendProgress(event.sender, {
      phase: 'analyzing',
      percent: 5,
      message: '正在分析备份',
      detail: `共 ${paths.length} 个文件`,
    })

    const inspected = []
    for (const [index, filePath] of paths.entries()) {
      const currentPercent = 5 + Math.round((index / paths.length) * 90)
      sendProgress(event.sender, {
        phase: 'analyzing',
        percent: currentPercent,
        message: `正在分析备份 ${index + 1}/${paths.length}`,
        detail: path.basename(filePath),
      })
      const [summary] = await inspectBackupPaths([filePath], (logMsg) => {
        sendProgress(event.sender, {
          phase: 'analyzing',
          percent: currentPercent,
          message: `正在分析备份 ${index + 1}/${paths.length}`,
          detail: path.basename(filePath),
          log: logMsg,
        })
      })
      inspected.push(summary)
    }

    sendProgress(event.sender, {
      phase: 'done',
      percent: 100,
      message: '分析完成',
      detail: `${inspected.length} 个备份`,
    })

    return inspected
  })


  ipcMain.handle('backups:choose-output', async (_event, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      title: '保存合并后的备份',
      defaultPath: defaultName,
      filters: [{ name: 'Cherry Studio Backup', extensions: ['zip'] }],
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('backups:merge', async (event, request: DesktopMergeRequest) => {
    const { result, writtenTo } = await mergeDirectBackups({
      inputPaths: request.inputPaths,
      outputPath: request.outputPath,
      mergeOptions: request.options,
      onProgress: (progress) => sendProgress(event.sender, progress),
    })

    return {
      outputPath: writtenTo,
      summary: result.stats,
      warnings: result.warnings,
    }
  })
}

function sendProgress(webContents: WebContents, progress: DesktopProgressEvent) {
  webContents.send('backups:progress', {
    ...progress,
    percent: Math.max(0, Math.min(100, Math.round(progress.percent))),
  })
}

function findSampleBackups() {
  const root = path.resolve(app.getAppPath())
  return readdirSync(root)
    .filter((fileName) => /^cherry-studio\..+\.zip$/i.test(fileName))
    .map((fileName) => path.join(root, fileName))
    .slice(0, 2)
}

async function createSelectedBackupSummaries(paths: string[]): Promise<DesktopBackupSummary[]> {
  return Promise.all(
    paths.map(async (filePath) => {
      const fileStat = await stat(filePath)
      return {
        id: `backup-${filePath}`,
        path: filePath,
        fileName: path.basename(filePath),
        fileSize: fileStat.size,
        format: inferFormat(filePath),
        version: 0,
        status: 'selected',
      }
    }),
  )
}

function inferFormat(filePath: string) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.zip') return 'zip_direct'
  if (ext === '.bak') return 'bak'
  if (ext === '.json') return 'json'
  return 'unknown'
}
