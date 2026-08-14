import { definePlatform } from '@drama-sync/platform-automation-core'
import type { Page } from 'playwright'

export const kuaishouPlatform = definePlatform({
  authMode: 'qr-code',
  envPrefix: 'PLATFORM_KUAISHOU',
  id: 'kuaishou',
  name: '快手',
})

export const kuaishouDataUrl = 'https://kdj.kuaishou.com/home/data/iaa-ad-data'
export const kuaishouLoginUrl = 'https://passport.kuaishou.com/pc/account/login'
export const kuaishouTeacherInfoUrl =
  'https://kdj.kuaishou.com/rest/ad/miniSeries/pc/teacher/info'
export const kuaishouMiniSeriesDownloadUrl =
  'https://kdj.kuaishou.com/rest/ad/pw/tube/vertical/data/iaa/downloadMiniSeriesData'

export interface KuaishouTeacherInfo {
  bizIdentity: number
  headUrl?: string
  miniSeriesAccountType: number
  name: string
  punished: boolean
  userId: number
}

interface KuaishouApiResponse<T> {
  data?: T
  error_msg?: string
  result?: number
  successful?: boolean
}

export interface KuaishouMiniSeriesDownload {
  body: Buffer
  contentDisposition?: string
  contentType: string
}

export async function getKuaishouTeacherInfo(
  page: Page,
): Promise<KuaishouTeacherInfo | undefined> {
  const response = await page.request.get(kuaishouTeacherInfoUrl, {
    headers: {
      accept: 'application/json',
      referer: kuaishouDataUrl,
    },
    timeout: 30_000,
  })

  if (!response.ok()) {
    return undefined
  }

  const payload = await response.json() as KuaishouApiResponse<unknown>
  if (payload.result !== 1 || payload.successful !== true || !isTeacherInfo(payload.data)) {
    return undefined
  }

  return payload.data
}

export async function downloadKuaishouMiniSeriesData(
  page: Page,
  options: {
    endDate: number
    miniSeriesIds?: number[]
    signal?: AbortSignal
    startDate: number
  },
): Promise<KuaishouMiniSeriesDownload> {
  throwIfAborted(options.signal)
  const response = await page.request.post(kuaishouMiniSeriesDownloadUrl, {
    data: {
      endDate: options.endDate,
      miniSeriesIds: options.miniSeriesIds ?? [],
      startDate: options.startDate,
    },
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      referer: kuaishouDataUrl,
    },
    timeout: 120_000,
  })

  if (!response.ok()) {
    const responseText = (await response.text()).slice(0, 500)
    throw new Error(`快手数据下载失败：HTTP ${response.status()} ${responseText}`.trim())
  }

  const body = await response.body()
  if (body.byteLength === 0) {
    throw new Error('快手数据下载失败：接口返回了空文件')
  }

  return {
    body,
    contentDisposition: response.headers()['content-disposition'],
    contentType: response.headers()['content-type'] ?? 'application/octet-stream',
  }
}

function isTeacherInfo(value: unknown): value is KuaishouTeacherInfo {
  return isRecord(value) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.userId === 'number' &&
    Number.isFinite(value.userId) &&
    typeof value.bizIdentity === 'number' &&
    typeof value.punished === 'boolean' &&
    typeof value.miniSeriesAccountType === 'number'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error('快手数据任务已停止')
  }
}
