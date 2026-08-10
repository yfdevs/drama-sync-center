import { definePlatform } from '@drama-sync/platform-automation-core'
import type { Page, Response } from 'playwright'

export const meituanPlatform = definePlatform({
  authMode: 'sms-code',
  envPrefix: 'PLATFORM_MEITUAN',
  id: 'meituan',
  name: '美团',
})

export const meituanLoginUrl = 'https://czz.meituan.com/new/login'
export const meituanVideoSetUrl = 'https://czz.meituan.com/new/videoset'

const videoSetApiUrl =
  'https://contents.meituan.com/api/author/videoset/listVideoSet'
const defaultRows = 30

interface MeituanVideoSetPageData {
  total: number
  videoSetList: unknown[]
}

interface MeituanVideoSetPageResponse {
  code: number
  data: MeituanVideoSetPageData
  message?: string | null
  success?: boolean
}

export interface FetchAllMeituanVideoSetsOptions {
  onPage?: (progress: {
    itemCount: number
    pageCount: number
    pageNumber: number
    total: number
  }) => void
  pageDelayMs?: number
  responseTimeoutMs?: number
  retries?: number
  rows?: number
  signal?: AbortSignal
}

export interface MeituanVideoSetCollection {
  pageCount: number
  rows: number
  total: number
  videoSetList: unknown[]
}

/**
 * Loads the first page through the official page flow, then requests remaining
 * pages from the page's window.fetch so Meituan's own H5guard wrapper can add
 * its security parameters. Session headers never leave this function.
 */
export async function fetchAllMeituanVideoSets(
  page: Page,
  options: FetchAllMeituanVideoSetsOptions = {},
): Promise<MeituanVideoSetCollection> {
  throwIfAborted(options.signal)

  const firstResponsePromise = page.waitForResponse(isFirstVideoSetResponse, {
    timeout: options.responseTimeoutMs ?? 120_000,
  })

  await page.goto(meituanVideoSetUrl, {
    waitUntil: 'domcontentloaded',
  })

  const firstResponse = await firstResponsePromise
  const firstBody = parseVideoSetResponse(await firstResponse.json())
  const originalHeaders = await firstResponse.request().allHeaders()
  const sessionHeaders = selectSessionHeaders(originalHeaders)
  const firstRequestUrl = new URL(firstResponse.url())
  const requestedRows = Number(firstRequestUrl.searchParams.get('rows'))
  const rows = normalizePositiveInteger(requestedRows, options.rows ?? 0, defaultRows)
  const pageCount = Math.max(1, Math.ceil(firstBody.data.total / rows))
  const allItems = [...firstBody.data.videoSetList]

  options.onPage?.({
    itemCount: allItems.length,
    pageCount,
    pageNumber: 1,
    total: firstBody.data.total,
  })

  for (let pageNumber = 2; pageNumber <= pageCount; pageNumber += 1) {
    await wait(options.pageDelayMs ?? 500, options.signal)
    const body = await fetchVideoSetPageWithRetry(page, {
      pageNumber,
      retries: options.retries ?? 2,
      rows,
      sessionHeaders,
      signal: options.signal,
    })
    allItems.push(...body.data.videoSetList)
    options.onPage?.({
      itemCount: allItems.length,
      pageCount,
      pageNumber,
      total: firstBody.data.total,
    })
  }

  return {
    pageCount,
    rows,
    total: firstBody.data.total,
    videoSetList: allItems,
  }
}

function isFirstVideoSetResponse(response: Response): boolean {
  const url = new URL(response.url())

  return (
    response.request().method() === 'GET' &&
    url.hostname === 'contents.meituan.com' &&
    url.pathname === '/api/author/videoset/listVideoSet' &&
    url.searchParams.get('page') === '1'
  )
}

function selectSessionHeaders(
  originalHeaders: Record<string, string>,
): Record<string, string> {
  const sessionHeaders: Record<string, string> = {
    accept: 'application/json, text/plain, */*',
  }

  for (const name of ['authorsource', 'mtuserid', 'token']) {
    const value = originalHeaders[name]
    if (!value) {
      throw new Error(`美团合集请求缺少必要会话请求头：${name}`)
    }
    sessionHeaders[name] = value
  }

  return sessionHeaders
}

async function fetchVideoSetPageWithRetry(
  page: Page,
  options: {
    pageNumber: number
    retries: number
    rows: number
    sessionHeaders: Record<string, string>
    signal?: AbortSignal
  },
): Promise<MeituanVideoSetPageResponse> {
  let lastError: unknown

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    throwIfAborted(options.signal)

    try {
      const body = await page.evaluate(
        async ({ endpoint, pageNumber, rows, sessionHeaders }) => {
          const url = new URL(endpoint)
          url.searchParams.set('page', String(pageNumber))
          url.searchParams.set('rows', String(rows))
          url.searchParams.set('authorId', '')
          url.searchParams.set('removeSelf', 'false')

          const response = await window.fetch(url, {
            credentials: 'omit',
            headers: sessionHeaders,
            method: 'GET',
          })

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
          }

          return response.json() as Promise<unknown>
        },
        {
          endpoint: videoSetApiUrl,
          pageNumber: options.pageNumber,
          rows: options.rows,
          sessionHeaders: options.sessionHeaders,
        },
      )

      return parseVideoSetResponse(body)
    } catch (error) {
      lastError = error
      if (attempt < options.retries) {
        await wait(1_000 * (attempt + 1), options.signal)
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`美团合集第 ${options.pageNumber} 页请求失败`)
}

function parseVideoSetResponse(value: unknown): MeituanVideoSetPageResponse {
  if (!isRecord(value)) {
    throw new Error('美团合集接口响应格式异常')
  }

  if (value.code !== 0) {
    throw new Error(
      typeof value.message === 'string'
        ? value.message
        : `美团合集接口错误：${String(value.code)}`,
    )
  }

  if (
    !isRecord(value.data) ||
    typeof value.data.total !== 'number' ||
    !Array.isArray(value.data.videoSetList)
  ) {
    throw new Error('美团合集接口数据格式异常')
  }

  return value as unknown as MeituanVideoSetPageResponse
}

function normalizePositiveInteger(
  preferred: number | undefined,
  fallback: number,
  defaultValue: number,
): number {
  for (const value of [preferred, fallback, defaultValue]) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return value
    }
  }

  return defaultValue
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error('美团合集任务已停止')
  }
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal)
    const onAbort = () => {
      clearTimeout(timeout)
      reject(signal?.reason ?? new Error('美团合集任务已停止'))
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
