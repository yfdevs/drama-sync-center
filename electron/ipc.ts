import { ipcMain } from 'electron'
import type { LogLevel } from './shared'
import { getDarenCenterCurrentUser, loginToDarenCenter } from './daren-center'
import { logger } from './logger'
import { getPlatformCatalog, openPlatformSession } from './platforms'
import { storeService } from './store'

const IPC_CHANNELS = {
  darenCenterLogin: 'daren-center:login',
  darenCenterMe: 'daren-center:me',
  log: 'app:log',
  platformList: 'platform:list',
  platformOpen: 'platform:open',
  storeDelete: 'store:delete',
  storeDeleteForPlatform: 'store:delete-for-platform',
  storeGet: 'store:get',
  storeGetForPlatform: 'store:get-for-platform',
  storeSet: 'store:set',
  storeSetForPlatform: 'store:set-for-platform',
} as const

function writeRendererLog(level: LogLevel, message: string, details?: unknown): void {
  const rendererLog = logger.scope('renderer')

  if (details === undefined) {
    rendererLog[level](message)
  } else {
    rendererLog[level](message, details)
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.darenCenterLogin, () => loginToDarenCenter())
  ipcMain.handle(IPC_CHANNELS.darenCenterMe, () => getDarenCenterCurrentUser())
  ipcMain.handle(IPC_CHANNELS.platformList, () => getPlatformCatalog())
  ipcMain.handle(
    IPC_CHANNELS.platformOpen,
    (_event, platformId: string, accountId: string) =>
      openPlatformSession(platformId, accountId),
  )

  ipcMain.handle(IPC_CHANNELS.storeGet, (_event, key: string) => storeService.get(key))
  ipcMain.handle(IPC_CHANNELS.storeSet, (_event, key: string, value: unknown) => {
    storeService.set(key, value)
  })
  ipcMain.handle(IPC_CHANNELS.storeDelete, (_event, key: string) => {
    storeService.delete(key)
  })

  ipcMain.handle(
    IPC_CHANNELS.storeGetForPlatform,
    (_event, platformId: string, key: string) => storeService.getForPlatform(platformId, key),
  )
  ipcMain.handle(
    IPC_CHANNELS.storeSetForPlatform,
    (_event, platformId: string, key: string, value: unknown) => {
      storeService.setForPlatform(platformId, key, value)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.storeDeleteForPlatform,
    (_event, platformId: string, key: string) => {
      storeService.deleteForPlatform(platformId, key)
    },
  )

  ipcMain.on(
    IPC_CHANNELS.log,
    (_event, level: LogLevel, message: string, details?: unknown) => {
      writeRendererLog(level, message, details)
    },
  )
}
