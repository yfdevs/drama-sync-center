export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

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

export interface DesktopApi {
  darenCenter: {
    login(): Promise<DarenCenterRequestResult<DarenCenterLoginData>>
    me<T = unknown>(): Promise<DarenCenterRequestResult<T>>
  }
  log: Record<LogLevel, (message: string, details?: unknown) => void>
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
}
