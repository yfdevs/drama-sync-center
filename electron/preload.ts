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
