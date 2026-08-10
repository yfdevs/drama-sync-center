import { app, shell } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import {
  listPlatformAccountIds,
  openPersistentPlatformSession,
} from '@drama-sync/platform-automation-core'
import {
  fetchAllMeituanVideoSets,
  meituanLoginUrl,
  meituanPlatform,
  meituanVideoSetUrl,
  type MeituanVideoSetCollection,
} from '@drama-sync/platform-meituan'
import { logger } from './logger'
import { loadPlatformAutomationEnvironment } from './platforms'
import type { MeituanSyncEvent } from './shared'

interface StartMeituanSyncOptions {
  sendEvent(event: MeituanSyncEvent): void
}

interface ActiveMeituanSyncJob {
  abortController: AbortController
  promise: Promise<void>
}

const syncLogger = logger.scope('meituan-sync')
const taskName = '合集数据处理'
const taskType = 'meituan-video-set-list'
let activeJob: ActiveMeituanSyncJob | undefined

export function startMeituanSync(options: StartMeituanSyncOptions): {
  running: boolean
  started: boolean
} {
  if (activeJob) {
    return {
      running: true,
      started: false,
    }
  }

  const abortController = new AbortController()
  const promise = runMeituanSync(options, abortController.signal)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      syncLogger.error('Meituan sync failed', { error: message })
      options.sendEvent({
        message,
        type: 'error',
      })
    })
    .finally(() => {
      activeJob = undefined
      options.sendEvent({
        message: '美团合集数据处理任务已停止',
        type: 'stopped',
      })
    })

  activeJob = {
    abortController,
    promise,
  }
  options.sendEvent({
    message: '美团合集数据处理任务已启动',
    type: 'started',
  })

  return {
    running: true,
    started: true,
  }
}

export async function stopMeituanSync(): Promise<{ stopped: boolean }> {
  if (!activeJob) {
    return { stopped: false }
  }

  const job = activeJob
  job.abortController.abort(new Error('美团合集任务已停止'))
  await job.promise
  return { stopped: true }
}

export async function openMeituanDownloadDirectory(): Promise<{
  error?: string
  path: string
}> {
  const directory = resolveDownloadDirectory()
  await mkdir(directory, { recursive: true })
  const error = await shell.openPath(directory)

  return {
    error: error || undefined,
    path: directory,
  }
}

async function runMeituanSync(
  options: StartMeituanSyncOptions,
  signal: AbortSignal,
): Promise<void> {
  const environment = loadPlatformAutomationEnvironment()
  const accountIds = listPlatformAccountIds(meituanPlatform, environment)
  const downloadDirectory = resolveDownloadDirectory()
  await mkdir(downloadDirectory, { recursive: true })

  for (const accountId of accountIds) {
    throwIfAborted(signal)
    const session = await openPersistentPlatformSession(meituanPlatform, accountId, {
      browserOptions: {
        viewport: null,
      },
      browsersPath: app.isPackaged
        ? path.join(process.resourcesPath, 'playwright-browsers')
        : path.join(process.env.APP_ROOT, 'build', 'playwright-browsers'),
      environment,
      headless: false,
      profileBaseDirectory: app.getPath('userData'),
    })
    const { page } = session

    signal.addEventListener(
      'abort',
      () => {
        void session.context.close().catch(() => undefined)
      },
      { once: true },
    )

    try {
      await ensureMeituanLogin(page, signal, options, session.config.account.label)
      const collection = await fetchAllMeituanVideoSets(page, {
        onPage: ({ itemCount, pageCount, pageNumber, total }) => {
          options.sendEvent({
            accountName: session.config.account.label,
            message: `美团合集第 ${pageNumber}/${pageCount} 页，累计 ${itemCount}/${total} 条`,
            pageCount,
            pageNumber,
            taskName,
            taskType,
            total,
            type: 'progress',
            uniqId: accountId,
          })
        },
        pageDelayMs: 500,
        retries: 2,
        signal,
      })
      const savedFile = await saveVideoSetCollection(collection, {
        accountId,
        accountName: session.config.account.label,
        downloadDirectory,
      })

      options.sendEvent({
        accountName: session.config.account.label,
        filePath: savedFile.filePath,
        filename: savedFile.filename,
        message: `美团合集数据已保存：${savedFile.filename}`,
        taskName,
        taskType,
        total: collection.total,
        type: 'downloaded',
        uniqId: accountId,
      })

      const importResult = await importMeituanVideoSets(savedFile, collection)
      options.sendEvent({
        accountName: session.config.account.label,
        filePath: savedFile.filePath,
        filename: savedFile.filename,
        message: '美团合集数据已下载，导入接口待接入',
        result: importResult,
        taskName,
        taskType,
        timestamp: new Date().toISOString(),
        total: collection.total,
        type: 'imported',
        uniqId: accountId,
      })
    } catch (error) {
      if (signal.aborted) {
        throw error
      }

      const failureReason = error instanceof Error ? error.message : String(error)
      syncLogger.error('Meituan account sync failed', {
        accountId,
        accountName: session.config.account.label,
        error: failureReason,
      })
      options.sendEvent({
        accountName: session.config.account.label,
        failureReason,
        message: `美团合集处理失败：${session.config.account.label}（${failureReason}）`,
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

async function ensureMeituanLogin(
  page: Page,
  signal: AbortSignal,
  options: StartMeituanSyncOptions,
  accountName: string,
): Promise<void> {
  await page.goto(meituanVideoSetUrl, {
    waitUntil: 'domcontentloaded',
  })

  if (isLoginPage(page.url())) {
    options.sendEvent({
      accountName,
      message: '请在打开的美团登录页完成登录',
      taskName,
      taskType,
      type: 'waiting-for-login',
    })
    await Promise.race([
      page.waitForURL((url) => !isLoginPage(url.href), { timeout: 0 }),
      waitForAbort(signal),
    ])
  }

  throwIfAborted(signal)
  options.sendEvent({
    accountName,
    message: '美团登录完成，正在获取合集数据',
    taskName,
    taskType,
    type: 'logged-in',
  })
}

function isLoginPage(urlValue: string): boolean {
  const url = new URL(urlValue, meituanLoginUrl)
  return url.origin === new URL(meituanLoginUrl).origin && url.pathname === '/new/login'
}

async function saveVideoSetCollection(
  collection: MeituanVideoSetCollection,
  options: {
    accountId: string
    accountName: string
    downloadDirectory: string
  },
): Promise<{ filePath: string; filename: string }> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `美团合集_${sanitizeFilename(options.accountName)}_${timestamp}.json`
  const filePath = path.join(options.downloadDirectory, filename)
  await writeFile(
    filePath,
    JSON.stringify(
      {
        account: {
          id: options.accountId,
          label: options.accountName,
        },
        fetchedAt: new Date().toISOString(),
        pageCount: collection.pageCount,
        rows: collection.rows,
        total: collection.total,
        videoSetList: collection.videoSetList,
      },
      undefined,
      2,
    ),
    'utf8',
  )

  return { filePath, filename }
}

/** Placeholder for the backend import endpoint that is not available yet. */
export async function importMeituanVideoSets(
  savedFile: { filePath: string; filename: string },
  collection: MeituanVideoSetCollection,
): Promise<{
  failed: number
  importPending: true
  success: number
  total: number
}> {
  syncLogger.info('Meituan import API is pending', {
    filePath: savedFile.filePath,
    filename: savedFile.filename,
    total: collection.total,
  })

  return {
    failed: 0,
    importPending: true,
    success: 0,
    total: collection.total,
  }
}

function resolveDownloadDirectory(): string {
  return path.join(app.getPath('userData'), 'downloads', meituanPlatform.id)
}

function sanitizeFilename(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80)

  return sanitized || 'unknown'
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new Error('美团合集任务已停止')
  }
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('美团合集任务已停止'))
      return
    }

    signal.addEventListener(
      'abort',
      () => reject(signal.reason ?? new Error('美团合集任务已停止')),
      { once: true },
    )
  })
}
