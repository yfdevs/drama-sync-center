import { app, dialog, shell } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import dayjs from 'dayjs'
import {
  downloadKuaishouMiniSeriesData,
  getKuaishouTeacherInfo,
  kuaishouDataUrl,
  kuaishouLoginUrl,
  kuaishouPlatform,
  type KuaishouMiniSeriesDownload,
  type KuaishouTeacherInfo,
} from '@drama-sync/platform-kuaishou'
import {
  listPlatformAccountIds,
  openPersistentPlatformSession,
} from '@drama-sync/platform-automation-core'
import { getDarenCenterClient } from './daren-center'
import { logger } from './logger'
import { loadPlatformAutomationEnvironment } from './platforms'
import type {
  KuaishouCustomDateRange,
  KuaishouDatePreset,
  KuaishouSettings,
  KuaishouSyncEvent,
} from './shared'
import { storeService } from './store'

interface StartKuaishouSyncOptions {
  sendEvent(event: KuaishouSyncEvent): void
}

interface ActiveKuaishouSyncJob {
  abortController: AbortController
  promise: Promise<void>
}

interface ResolvedDateRange {
  endDate: string
  endTimestamp: number
  label: string
  startDate: string
  startTimestamp: number
}

const settingsStoreKey = 'kuaishou-settings'
const taskName = 'IAA 短剧数据处理'
const taskType = 'kuaishou-iaa-mini-series-data'
const syncLogger = logger.scope('kuaishou-sync')
const defaultSettings: KuaishouSettings = {
  datePreset: 'previous-day',
}
let activeJob: ActiveKuaishouSyncJob | undefined

export function getKuaishouSettings(): KuaishouSettings {
  return normalizeSettings(storeService.get(settingsStoreKey))
}

export function saveKuaishouSettings(value: unknown): KuaishouSettings {
  const settings = normalizeSettings(value)
  storeService.set(settingsStoreKey, settings)
  return settings
}

export async function chooseKuaishouDownloadDirectory(): Promise<string | undefined> {
  const result = await dialog.showOpenDialog({
    defaultPath: getKuaishouSettings().downloadDirectory,
    properties: ['openDirectory', 'createDirectory'],
    title: '选择快手数据文件保存位置',
  })

  return result.canceled ? undefined : result.filePaths[0]
}

export async function openKuaishouDownloadDirectory(): Promise<{
  error?: string
  path: string
}> {
  const directory = resolveDownloadDirectory(getKuaishouSettings())
  await mkdir(directory, { recursive: true })
  const error = await shell.openPath(directory)

  return {
    error: error || undefined,
    path: directory,
  }
}

export function startKuaishouSync(options: StartKuaishouSyncOptions): {
  running: boolean
  started: boolean
} {
  if (activeJob) {
    return { running: true, started: false }
  }

  const abortController = new AbortController()
  const promise = runKuaishouSync(options, abortController.signal)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      syncLogger.error('Kuaishou sync failed', { error: message })
      options.sendEvent({ message, type: 'error' })
    })
    .finally(() => {
      activeJob = undefined
      options.sendEvent({ message: '快手数据处理任务已停止', type: 'stopped' })
    })

  activeJob = { abortController, promise }
  options.sendEvent({
    message: '快手 IAA 短剧数据处理任务已启动',
    taskName,
    taskType,
    type: 'started',
  })

  return { running: true, started: true }
}

export async function stopKuaishouSync(): Promise<{ stopped: boolean }> {
  if (!activeJob) {
    return { stopped: false }
  }

  const job = activeJob
  job.abortController.abort(new Error('快手数据任务已停止'))
  await job.promise
  return { stopped: true }
}

async function runKuaishouSync(
  options: StartKuaishouSyncOptions,
  signal: AbortSignal,
): Promise<void> {
  const environment = loadPlatformAutomationEnvironment()
  const accountIds = listPlatformAccountIds(kuaishouPlatform, environment)
  const settings = getKuaishouSettings()
  const dateRange = resolveDateRange(settings.datePreset, settings.customDateRange)
  const downloadDirectory = resolveDownloadDirectory(settings)
  await mkdir(downloadDirectory, { recursive: true })
  syncLogger.info('Kuaishou sync runtime prepared', {
    accountCount: accountIds.length,
    datePreset: settings.datePreset,
    downloadDirectory,
    endDate: dateRange.endDate,
    endTimestamp: dateRange.endTimestamp,
    startDate: dateRange.startDate,
    startTimestamp: dateRange.startTimestamp,
  })

  for (const accountId of accountIds) {
    throwIfAborted(signal)
    const session = await openPersistentPlatformSession(kuaishouPlatform, accountId, {
      browserOptions: {
        acceptDownloads: true,
        viewport: null,
      },
      browsersPath: app.isPackaged
        ? path.join(process.resourcesPath, 'playwright-browsers')
        : path.join(process.env.APP_ROOT, 'build', 'playwright-browsers'),
      environment,
      headless: false,
      profileBaseDirectory: app.getPath('userData'),
    })
    syncLogger.info('Kuaishou persistent session opened', {
      accountId,
      accountLabel: session.config.account.label,
      profilePath: session.profilePath,
    })

    signal.addEventListener(
      'abort',
      () => {
        void session.context.close().catch(() => undefined)
      },
      { once: true },
    )

    try {
      const teacherInfo = await ensureKuaishouLogin(session.page, signal, options)
      syncLogger.info('Kuaishou account authenticated', {
        accountId,
        accountName: teacherInfo.name,
        bizIdentity: teacherInfo.bizIdentity,
        miniSeriesAccountType: teacherInfo.miniSeriesAccountType,
        punished: teacherInfo.punished,
        userId: teacherInfo.userId,
      })
      options.sendEvent({
        accountName: teacherInfo.name,
        message: `登录状态正常，正在下载 ${dateRange.label} 的快手短剧数据`,
        targetDate: dateRange.label,
        taskName,
        taskType,
        type: 'logged-in',
        uniqId: String(teacherInfo.userId),
      })

      syncLogger.info('Requesting Kuaishou mini-series download', {
        accountName: teacherInfo.name,
        endTimestamp: dateRange.endTimestamp,
        miniSeriesIds: [],
        startTimestamp: dateRange.startTimestamp,
        targetDate: dateRange.label,
        userId: teacherInfo.userId,
      })
      const download = await downloadKuaishouMiniSeriesData(session.page, {
        endDate: dateRange.endTimestamp,
        signal,
        startDate: dateRange.startTimestamp,
      })
      syncLogger.info('Kuaishou download response received', {
        bytes: download.body.byteLength,
        contentDisposition: download.contentDisposition,
        contentType: download.contentType,
        userId: teacherInfo.userId,
      })
      const savedFile = await saveDownload(download, {
        accountName: teacherInfo.name,
        dateRange,
        downloadDirectory,
      })

      options.sendEvent({
        accountName: teacherInfo.name,
        filePath: savedFile.filePath,
        filename: savedFile.filename,
        message: `快手数据下载完成：${savedFile.filename}`,
        targetDate: dateRange.label,
        taskName,
        taskType,
        type: 'downloaded',
        uniqId: String(teacherInfo.userId),
      })

      syncLogger.info('Uploading Kuaishou file to import API', {
        accountName: teacherInfo.name,
        filePath: savedFile.filePath,
        filename: savedFile.filename,
        userId: teacherInfo.userId,
      })
      const importResult = await importDownloadedFile(savedFile)
      syncLogger.info('Kuaishou import API completed', {
        errorCount: importResult.body.data?.errors.length,
        failCount: importResult.body.data?.failCount,
        filename: savedFile.filename,
        message: importResult.body.message,
        status: importResult.status,
        successCount: importResult.body.data?.successCount,
        totalCount: importResult.body.data?.totalCount,
        userId: teacherInfo.userId,
      })
      options.sendEvent({
        accountName: teacherInfo.name,
        filePath: savedFile.filePath,
        filename: savedFile.filename,
        message: `快手数据导入完成：${teacherInfo.name}`,
        result: importResult.body,
        targetDate: dateRange.label,
        taskName,
        taskType,
        timestamp: new Date().toISOString(),
        type: 'imported',
        uniqId: String(teacherInfo.userId),
      })
    } catch (error) {
      if (signal.aborted) {
        throw error
      }

      const failureReason = error instanceof Error ? error.message : String(error)
      syncLogger.error('Kuaishou account sync failed', { accountId, error: failureReason })
      options.sendEvent({
        accountName: session.config.account.label,
        failureReason,
        message: `快手数据处理失败：${failureReason}`,
        targetDate: dateRange.label,
        taskName,
        taskType,
        timestamp: new Date().toISOString(),
        type: 'account-failed',
        uniqId: accountId,
      })
    } finally {
      await session.context.close().catch(() => undefined)
    }
  }
}

async function ensureKuaishouLogin(
  page: Page,
  signal: AbortSignal,
  options: StartKuaishouSyncOptions,
): Promise<KuaishouTeacherInfo> {
  await page.goto(kuaishouDataUrl, { waitUntil: 'domcontentloaded' })
  syncLogger.info('Checking Kuaishou login state', { url: page.url() })
  let teacherInfo = await getKuaishouTeacherInfo(page).catch(() => undefined)
  if (teacherInfo) {
    syncLogger.info('Existing Kuaishou login session is valid', {
      accountName: teacherInfo.name,
      userId: teacherInfo.userId,
    })
    return teacherInfo
  }

  syncLogger.info('Kuaishou login is required; opening login page', {
    loginUrl: kuaishouLoginUrl,
  })
  options.sendEvent({
    message: '请在打开的快手登录页完成扫码登录',
    taskName,
    taskType,
    type: 'waiting-for-login',
  })
  await page.goto(kuaishouLoginUrl, { waitUntil: 'domcontentloaded' })

  let loginCheckCount = 0
  while (!signal.aborted) {
    await wait(1_000, signal)
    loginCheckCount += 1
    teacherInfo = await getKuaishouTeacherInfo(page).catch(() => undefined)
    if (teacherInfo) {
      syncLogger.info('Kuaishou login detected', {
        accountName: teacherInfo.name,
        checks: loginCheckCount,
        userId: teacherInfo.userId,
      })
      if (!page.url().startsWith(kuaishouDataUrl)) {
        await page.goto(kuaishouDataUrl, { waitUntil: 'domcontentloaded' })
      }
      return teacherInfo
    }
    if (loginCheckCount % 10 === 0) {
      syncLogger.info('Waiting for Kuaishou login', { checks: loginCheckCount })
    }
  }

  throwIfAborted(signal)
  throw new Error('快手登录未完成')
}

async function saveDownload(
  download: KuaishouMiniSeriesDownload,
  options: {
    accountName: string
    dateRange: ResolvedDateRange
    downloadDirectory: string
  },
): Promise<{ filePath: string; filename: string }> {
  const extension = resolveFileExtension(download)
  const filename = [
    '快手短剧',
    sanitizeFilename(options.accountName),
    options.dateRange.label.replace('至', '_'),
    new Date().toISOString().replace(/[:.]/g, '-'),
  ].join('_') + extension
  const filePath = path.join(options.downloadDirectory, filename)
  await writeFile(filePath, download.body)

  syncLogger.info('Kuaishou download saved', {
    bytes: download.body.byteLength,
    contentType: download.contentType,
    filePath,
  })
  return { filePath, filename }
}

async function importDownloadedFile(
  savedFile: { filePath: string; filename: string },
) {
  const client = getDarenCenterClient()
  const fileBuffer = await readFile(savedFile.filePath)
  return client.importKuaishouRecords({
    file: new Blob([new Uint8Array(fileBuffer)], {
      type: contentTypeForFilename(savedFile.filename),
    }),
    filename: savedFile.filename,
  })
}

function normalizeSettings(value: unknown): KuaishouSettings {
  const raw = isRecord(value) ? value : {}
  const downloadDirectory =
    typeof raw.downloadDirectory === 'string' && raw.downloadDirectory.trim()
      ? path.resolve(raw.downloadDirectory.trim())
      : undefined

  return {
    customDateRange: normalizeCustomDateRange(raw.customDateRange),
    datePreset: normalizeDatePreset(raw.datePreset),
    downloadDirectory,
  }
}

function normalizeCustomDateRange(value: unknown): KuaishouCustomDateRange | undefined {
  if (!isRecord(value) || !isIsoDate(value.startDate) || !isIsoDate(value.endDate)) {
    return undefined
  }

  return { endDate: value.endDate, startDate: value.startDate }
}

function normalizeDatePreset(value: unknown): KuaishouDatePreset {
  return value === 'today' ||
    value === 'last-7-days' ||
    value === 'month-to-date' ||
    value === 'previous-month' ||
    value === 'custom'
    ? value
    : defaultSettings.datePreset
}

function resolveDateRange(
  preset: KuaishouDatePreset,
  customRange?: KuaishouCustomDateRange,
): ResolvedDateRange {
  let start: dayjs.Dayjs
  let end: dayjs.Dayjs

  if (preset === 'custom') {
    if (!customRange || customRange.endDate < customRange.startDate) {
      throw new Error('快手自定义日期范围无效')
    }
    start = dayjs(customRange.startDate)
    end = dayjs(customRange.endDate)
  } else {
    const today = dayjs()
    start = today
    end = today

    if (preset === 'previous-day') {
      start = today.subtract(1, 'day')
      end = start
    } else if (preset === 'last-7-days') {
      start = today.subtract(6, 'day')
    } else if (preset === 'month-to-date') {
      start = today.startOf('month')
    } else if (preset === 'previous-month') {
      start = today.subtract(1, 'month').startOf('month')
      end = today.subtract(1, 'month').endOf('month')
    }
  }

  const startDate = start.format('YYYY-MM-DD')
  const endDate = end.format('YYYY-MM-DD')
  return {
    endDate,
    endTimestamp: end.endOf('day').valueOf(),
    label: startDate === endDate ? startDate : `${startDate}至${endDate}`,
    startDate,
    startTimestamp: start.startOf('day').valueOf(),
  }
}

function resolveDownloadDirectory(settings: KuaishouSettings): string {
  return settings.downloadDirectory ?? path.join(
    app.getPath('userData'),
    'downloads',
    kuaishouPlatform.id,
  )
}

function resolveFileExtension(download: KuaishouMiniSeriesDownload): string {
  const dispositionFilename = filenameFromContentDisposition(download.contentDisposition)
  const dispositionExtension = dispositionFilename ? path.extname(dispositionFilename) : ''
  if (/^\.(?:csv|xls|xlsx)$/i.test(dispositionExtension)) {
    return dispositionExtension.toLowerCase()
  }

  if (download.body.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    return '.xlsx'
  }
  if (download.body.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) {
    return '.xls'
  }

  return download.contentType.includes('csv') ? '.csv' : '.xlsx'
}

function filenameFromContentDisposition(value?: string): string | undefined {
  if (!value) {
    return undefined
  }

  const encodedMatch = /filename\*=UTF-8''([^;]+)/i.exec(value)
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1])
    } catch {
      return encodedMatch[1]
    }
  }

  return /filename="?([^";]+)"?/i.exec(value)?.[1]
}

function contentTypeForFilename(filename: string): string {
  if (filename.endsWith('.xlsx')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  }
  if (filename.endsWith('.csv')) {
    return 'text/csv'
  }
  return 'application/vnd.ms-excel'
}

function sanitizeFilename(value: string): string {
  return value
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80) || 'unknown'
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    dayjs(value).format('YYYY-MM-DD') === value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new Error('快手数据任务已停止')
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal)
    const onAbort = () => {
      clearTimeout(timeout)
      reject(signal.reason ?? new Error('快手数据任务已停止'))
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
