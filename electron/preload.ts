import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi, LogLevel } from './shared'

const log = (level: LogLevel) => (message: string, details?: unknown) => {
  ipcRenderer.send('app:log', level, message, details)
}

const desktopApi: DesktopApi = {
  darenCenter: {
    login: () => ipcRenderer.invoke('daren-center:login'),
    me: () => ipcRenderer.invoke('daren-center:me'),
  },
  log: {
    debug: log('debug'),
    error: log('error'),
    info: log('info'),
    warn: log('warn'),
  },
  platforms: {
    list: () => ipcRenderer.invoke('platform:list'),
    open: (platformId, accountId) =>
      ipcRenderer.invoke('platform:open', platformId, accountId),
  },
  weixinChannels: {
    chooseDownloadDirectory: () =>
      ipcRenderer.invoke('weixin-channels:choose-download-directory'),
    getSettings: () => ipcRenderer.invoke('weixin-channels:settings-get'),
    onSyncEvent: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        callback(payload as Parameters<typeof callback>[0])
      }
      ipcRenderer.on('weixin-channels:sync-event', listener)
      return () => {
        ipcRenderer.off('weixin-channels:sync-event', listener)
      }
    },
    openDownloadDirectory: () =>
      ipcRenderer.invoke('weixin-channels:open-download-directory'),
    saveSettings: (settings) =>
      ipcRenderer.invoke('weixin-channels:settings-save', settings),
    startSync: (mode) => ipcRenderer.invoke('weixin-channels:sync-start', mode),
    stopSync: (mode) => ipcRenderer.invoke('weixin-channels:sync-stop', mode),
  },
  store: {
    delete: (key) => ipcRenderer.invoke('store:delete', key),
    deleteForPlatform: (platformId, key) =>
      ipcRenderer.invoke('store:delete-for-platform', platformId, key),
    get: (key) => ipcRenderer.invoke('store:get', key),
    getForPlatform: (platformId, key) =>
      ipcRenderer.invoke('store:get-for-platform', platformId, key),
    set: (key, value) => ipcRenderer.invoke('store:set', key, value),
    setForPlatform: (platformId, key, value) =>
      ipcRenderer.invoke('store:set-for-platform', platformId, key, value),
  },
}

contextBridge.exposeInMainWorld('desktop', desktopApi)
