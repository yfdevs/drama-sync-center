export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type WeixinChannelsSyncMode = 'assistant' | 'promote'
export type WeixinChannelsDatePreset =
  | 'previous-day'
  | 'today'
  | 'last-7-days'
  | 'month-to-date'
  | 'previous-month'
  | 'custom'

export interface WeixinChannelsCustomDateRange {
  endDate: string
  startDate: string
}

export interface WeixinChannelsSettings {
  assistantCustomDateRange?: WeixinChannelsCustomDateRange
  assistantDatePreset: WeixinChannelsDatePreset
  downloadDirectory?: string
  promoteCustomDateRange?: WeixinChannelsCustomDateRange
  promoteDatePreset: WeixinChannelsDatePreset
}

interface DarenCenterApiResponse<T> {
  clientType: string
  data: T | null
  message: string
  service: string
}

interface DarenCenterRequestResult<T> {
  body: DarenCenterApiResponse<T>
  status: number
  statusText: string
}

interface DarenCenterLoginData {
  loginId: string
  loginType: string
  tokenName: string
  tokenValue: string
}

interface PlatformCatalogItem {
  accounts: Array<{
    id: string
    label: string
  }>
  authMode: string
  id: string
  loginNote: string
  name: string
  url: string
}

export interface WeixinChannelsSyncEvent {
  accountName?: string
  failureReason?: string
  filename?: string
  filePath?: string
  message: string
  mode?: WeixinChannelsSyncMode
  result?: unknown
  sourceId?: number
  taskName?: string
  taskType?: string
  targetDate?: string
  timestamp?: string
  type:
    | 'account-failed'
    | 'downloaded'
    | 'error'
    | 'imported'
    | 'logged-in'
    | 'signed-out'
    | 'started'
    | 'stopped'
    | 'waiting-for-scan'
  uniqId?: string
}

export interface MeituanSyncEvent {
  accountName?: string
  failureReason?: string
  filename?: string
  filePath?: string
  message: string
  pageCount?: number
  pageNumber?: number
  result?: unknown
  taskName?: string
  taskType?: string
  timestamp?: string
  total?: number
  type:
    | 'account-failed'
    | 'downloaded'
    | 'error'
    | 'imported'
    | 'logged-in'
    | 'progress'
    | 'started'
    | 'stopped'
    | 'waiting-for-login'
  uniqId?: string
}

export interface DesktopApi {
  darenCenter: {
    login(): Promise<DarenCenterRequestResult<DarenCenterLoginData>>
    me<T = unknown>(): Promise<DarenCenterRequestResult<T>>
  }
  log: Record<LogLevel, (message: string, details?: unknown) => void>
  meituan: {
    onSyncEvent(callback: (event: MeituanSyncEvent) => void): () => void
    openDownloadDirectory(): Promise<{
      error?: string
      path: string
    }>
    startSync(): Promise<{
      running: boolean
      started: boolean
    }>
    stopSync(): Promise<{
      stopped: boolean
    }>
  }
  platforms: {
    list(): Promise<PlatformCatalogItem[]>
    open(
      platformId: string,
      accountId: string,
    ): Promise<{
      accountId: string
      platformId: string
      profilePath: string
    }>
  }
  store: {
    delete(key: string): Promise<void>
    deleteForPlatform(platformId: string, key: string): Promise<void>
    get<T = unknown>(key: string): Promise<T | undefined>
    getForPlatform<T = unknown>(platformId: string, key: string): Promise<T | undefined>
    set(key: string, value: unknown): Promise<void>
    setForPlatform(platformId: string, key: string, value: unknown): Promise<void>
  }
  weixinChannels: {
    chooseDownloadDirectory(): Promise<string | undefined>
    getSettings(): Promise<WeixinChannelsSettings>
    onSyncEvent(callback: (event: WeixinChannelsSyncEvent) => void): () => void
    openDownloadDirectory(): Promise<{
      error?: string
      path: string
    }>
    saveSettings(settings: WeixinChannelsSettings): Promise<WeixinChannelsSettings>
    startSync(mode: WeixinChannelsSyncMode): Promise<{
      mode: WeixinChannelsSyncMode
      running: boolean
      started: boolean
    }>
    stopSync(mode?: WeixinChannelsSyncMode): Promise<{
      stopped: boolean
    }>
  }
}
