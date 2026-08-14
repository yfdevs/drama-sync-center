import { app, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateSource, UpdateState } from './shared'
import { logger } from './logger'
import { storeService } from './store'

const { autoUpdater } = electronUpdater
const GITHUB_RELEASE_BASE =
  'https://github.com/yfdevs/drama-sync-center/releases/latest/download/'

const DEFAULT_UPDATE_SOURCES: UpdateSource[] = [
  {
    description: '速度取决于当前网络，始终优先验证官方发布文件。',
    id: 'github',
    name: 'GitHub 官方源',
    url: GITHUB_RELEASE_BASE,
  },
  {
    description: '国内网络备用线路，官方源不可用时可选择。',
    id: 'gh-proxy',
    name: '镜像 · gh-proxy.com',
    url: `https://gh-proxy.com/${GITHUB_RELEASE_BASE}`,
  },
  {
    description: '第二备用线路，前两个源连接失败时使用。',
    id: 'gh-3w',
    name: '镜像 · gh.3w.pm',
    url: `https://gh.3w.pm/${GITHUB_RELEASE_BASE}`,
  },
]

const INITIAL_CHECK_DELAY_MS = 5_000
const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000
const UPDATE_SOURCE_STORE_KEY = 'update-source'

let activeOperation: Promise<UpdateState> | undefined
let started = false

function configuredSources(): UpdateSource[] {
  const customUrls = process.env.DRAMA_SYNC_UPDATE_MIRRORS
    ?.split(',')
    .map((url) => url.trim())
    .filter(Boolean)

  if (!customUrls?.length) return DEFAULT_UPDATE_SOURCES

  return customUrls.map((url, index) => ({
    description: '由 DRAMA_SYNC_UPDATE_MIRRORS 配置。',
    id: `custom-${index + 1}`,
    name: `自定义更新源 ${index + 1}`,
    url: url.endsWith('/') ? url : `${url}/`,
  }))
}

function selectedSourceId(): string {
  const stored = storeService.get(UPDATE_SOURCE_STORE_KEY)
  const sources = configuredSources()

  return typeof stored === 'string' && sources.some((source) => source.id === stored)
    ? stored
    : sources[0].id
}

let state: UpdateState = {
  currentVersion: app.getVersion(),
  message: app.isPackaged ? '尚未检查更新' : '开发环境不检查更新',
  phase: app.isPackaged ? 'idle' : 'unsupported',
  progress: 0,
  selectedSourceId: selectedSourceId(),
}

function sourcesInFallbackOrder(): UpdateSource[] {
  const sources = configuredSources()
  const selectedId = selectedSourceId()
  const selected = sources.find((source) => source.id === selectedId)
  return selected
    ? [selected, ...sources.filter((source) => source.id !== selectedId)]
    : sources
}

function updateState(patch: Partial<UpdateState>): UpdateState {
  state = { ...state, ...patch }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('updater:status', state)
  }
  return state
}

async function runUpdateOperation(download: boolean): Promise<UpdateState> {
  if (!app.isPackaged) {
    return updateState({
      message: '开发环境不检查更新，请安装正式版本后使用。',
      phase: 'unsupported',
    })
  }

  const failures: string[] = []
  for (const source of sourcesInFallbackOrder()) {
    try {
      updateState({
        message: download ? `正在连接 ${source.name}` : `正在通过 ${source.name} 检查`,
        phase: download ? 'downloading' : 'checking',
        progress: 0,
        sourceId: source.id,
        sourceName: source.name,
      })
      logger.info('Checking for updates', { download, source: source.name, url: source.url })
      autoUpdater.setFeedURL({ provider: 'generic', url: source.url })
      const result = await autoUpdater.checkForUpdates()

      if (!result?.isUpdateAvailable) {
        logger.info('Application is up to date', { source: source.name })
        return updateState({
          availableVersion: undefined,
          message: '当前已是最新版本',
          phase: 'up-to-date',
          progress: 0,
        })
      }

      if (!download) {
        return updateState({
          availableVersion: result.updateInfo.version,
          message: `发现新版本 v${result.updateInfo.version}`,
          phase: 'available',
          progress: 0,
        })
      }

      updateState({
        availableVersion: result.updateInfo.version,
        message: `正在下载 v${result.updateInfo.version}`,
        phase: 'downloading',
      })
      await autoUpdater.downloadUpdate()
      return updateState({
        message: `v${result.updateInfo.version} 已下载，等待安装`,
        phase: 'downloaded',
        progress: 100,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      failures.push(`${source.name}: ${reason}`)
      logger.warn('Update source failed, trying next source', { error, source: source.name })
    }
  }

  logger.error('All update sources failed', failures)
  return updateState({
    message: '所有更新源均连接失败，请稍后重试或切换网络。',
    phase: 'error',
    progress: 0,
  })
}

function startOperation(download: boolean): Promise<UpdateState> {
  if (activeOperation) return activeOperation
  activeOperation = runUpdateOperation(download).finally(() => {
    activeOperation = undefined
  })
  return activeOperation
}

export function checkForUpdates(): Promise<UpdateState> {
  return startOperation(false)
}

export function downloadUpdate(): Promise<UpdateState> {
  return startOperation(true)
}

export function getUpdateSources(): UpdateSource[] {
  return configuredSources().map((source) => ({ ...source }))
}

export function getUpdateState(): UpdateState {
  return { ...state, selectedSourceId: selectedSourceId() }
}

export function installDownloadedUpdate(): boolean {
  if (state.phase !== 'downloaded') return false
  autoUpdater.quitAndInstall(false, true)
  return true
}

export function setUpdateSource(sourceId: string): UpdateState {
  if (!configuredSources().some((source) => source.id === sourceId)) {
    throw new Error(`Unknown update source: ${sourceId}`)
  }
  storeService.set(UPDATE_SOURCE_STORE_KEY, sourceId)
  return updateState({
    message: '更新源已切换，下次检查时生效。',
    selectedSourceId: sourceId,
  })
}

export function startAutoUpdater() {
  if (started || !app.isPackaged) return
  started = true

  autoUpdater.logger = logger
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('download-progress', (progress) => {
    updateState({
      message: `正在下载 v${state.availableVersion ?? ''}`.trim(),
      phase: 'downloading',
      progress: Math.round(progress.percent),
    })
  })
  autoUpdater.on('error', (error) => logger.warn('Auto updater error', error))

  setTimeout(() => void checkForUpdates(), INITIAL_CHECK_DELAY_MS)
  setInterval(() => void checkForUpdates(), PERIODIC_CHECK_INTERVAL_MS)
}
