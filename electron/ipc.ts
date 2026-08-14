import { ipcMain } from 'electron'
import type { LogLevel, WeixinChannelsSyncMode } from './shared'
import { getDarenCenterCurrentUser, loginToDarenCenter } from './daren-center'
import { logger } from './logger'
import {
  chooseKuaishouDownloadDirectory,
  getKuaishouSettings,
  openKuaishouDownloadDirectory,
  saveKuaishouSettings,
  startKuaishouSync,
  stopKuaishouSync,
} from './kuaishou-sync'
import {
  openMeituanDownloadDirectory,
  startMeituanSync,
  stopMeituanSync,
} from './meituan-sync'
import { getPlatformCatalog, openPlatformSession } from './platforms'
import { storeService } from './store'
import {
  chooseWeixinChannelsDownloadDirectory,
  getWeixinChannelsSettings,
  openWeixinChannelsDownloadDirectory,
  saveWeixinChannelsSettings,
  startWeixinChannelsSync,
  stopWeixinChannelsSync,
} from './weixin-channels-sync'

const IPC_CHANNELS = {
  darenCenterLogin: 'daren-center:login',
  darenCenterMe: 'daren-center:me',
  log: 'app:log',
  kuaishouChooseDownloadDirectory: 'kuaishou:choose-download-directory',
  kuaishouOpenDownloadDirectory: 'kuaishou:open-download-directory',
  kuaishouSettingsGet: 'kuaishou:settings-get',
  kuaishouSettingsSave: 'kuaishou:settings-save',
  kuaishouSyncEvent: 'kuaishou:sync-event',
  kuaishouSyncStart: 'kuaishou:sync-start',
  kuaishouSyncStop: 'kuaishou:sync-stop',
  meituanOpenDownloadDirectory: 'meituan:open-download-directory',
  meituanSyncEvent: 'meituan:sync-event',
  meituanSyncStart: 'meituan:sync-start',
  meituanSyncStop: 'meituan:sync-stop',
  platformList: 'platform:list',
  platformOpen: 'platform:open',
  weixinChannelsSyncEvent: 'weixin-channels:sync-event',
  weixinChannelsChooseDownloadDirectory: 'weixin-channels:choose-download-directory',
  weixinChannelsOpenDownloadDirectory: 'weixin-channels:open-download-directory',
  weixinChannelsSettingsGet: 'weixin-channels:settings-get',
  weixinChannelsSettingsSave: 'weixin-channels:settings-save',
  weixinChannelsSyncStart: 'weixin-channels:sync-start',
  weixinChannelsSyncStop: 'weixin-channels:sync-stop',
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
  ipcMain.handle(IPC_CHANNELS.kuaishouSyncStart, (event) =>
    startKuaishouSync({
      sendEvent: (payload) => event.sender.send(IPC_CHANNELS.kuaishouSyncEvent, payload),
    }),
  )
  ipcMain.handle(IPC_CHANNELS.kuaishouSyncStop, () => stopKuaishouSync())
  ipcMain.handle(IPC_CHANNELS.kuaishouSettingsGet, () => getKuaishouSettings())
  ipcMain.handle(IPC_CHANNELS.kuaishouSettingsSave, (_event, settings) =>
    saveKuaishouSettings(settings),
  )
  ipcMain.handle(IPC_CHANNELS.kuaishouChooseDownloadDirectory, () =>
    chooseKuaishouDownloadDirectory(),
  )
  ipcMain.handle(IPC_CHANNELS.kuaishouOpenDownloadDirectory, () =>
    openKuaishouDownloadDirectory(),
  )
  ipcMain.handle(IPC_CHANNELS.meituanSyncStart, (event) =>
    startMeituanSync({
      sendEvent: (payload) =>
        event.sender.send(IPC_CHANNELS.meituanSyncEvent, payload),
    }),
  )
  ipcMain.handle(IPC_CHANNELS.meituanSyncStop, () => stopMeituanSync())
  ipcMain.handle(IPC_CHANNELS.meituanOpenDownloadDirectory, () =>
    openMeituanDownloadDirectory(),
  )
  ipcMain.handle(IPC_CHANNELS.platformList, () => getPlatformCatalog())
  ipcMain.handle(
    IPC_CHANNELS.platformOpen,
    (_event, platformId: string, accountId: string) =>
      openPlatformSession(platformId, accountId),
  )
  ipcMain.handle(
    IPC_CHANNELS.weixinChannelsSyncStart,
    (event, mode: WeixinChannelsSyncMode) =>
      startWeixinChannelsSync(
        {
          sendEvent: (payload) =>
            event.sender.send(IPC_CHANNELS.weixinChannelsSyncEvent, payload),
        },
        mode,
      ),
  )
  ipcMain.handle(IPC_CHANNELS.weixinChannelsSyncStop, (_event, mode?: WeixinChannelsSyncMode) =>
    stopWeixinChannelsSync(mode),
  )
  ipcMain.handle(IPC_CHANNELS.weixinChannelsSettingsGet, () => getWeixinChannelsSettings())
  ipcMain.handle(IPC_CHANNELS.weixinChannelsSettingsSave, (_event, settings) =>
    saveWeixinChannelsSettings(settings),
  )
  ipcMain.handle(IPC_CHANNELS.weixinChannelsChooseDownloadDirectory, () =>
    chooseWeixinChannelsDownloadDirectory(),
  )
  ipcMain.handle(IPC_CHANNELS.weixinChannelsOpenDownloadDirectory, () =>
    openWeixinChannelsDownloadDirectory(),
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
