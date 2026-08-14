import { app, dialog, shell } from "electron";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Download, Locator, Page, Request, Response } from "playwright";
import dayjs from "dayjs";
import { loadPlatformRuntimeConfig } from "@drama-sync/platform-automation-core";
import { weixinChannelsPlatform } from "@drama-sync/platform-weixin-channels";
import { getDarenCenterClient } from "./daren-center";
import { logger } from "./logger";
import { loadPlatformAutomationEnvironment } from "./platforms";
import type {
  WeixinChannelsCustomDateRange,
  WeixinChannelsDatePreset,
  WeixinChannelsSettings,
  WeixinChannelsSyncEvent,
  WeixinChannelsSyncMode,
} from "./shared";
import { storeService } from "./store";

interface StartWeixinChannelsSyncOptions {
  sendEvent(event: WeixinChannelsSyncEvent): void;
}

interface WeixinAuthData {
  errCode: number;
  errMsg?: string;
  data?: {
    finderUser?: {
      nickname?: string;
      uniqId?: string;
    };
    userAttr?: {
      nickname?: string;
    };
  };
}

interface ActiveWeixinSyncJob {
  abortController: AbortController;
  mode: WeixinChannelsSyncMode;
  promise: Promise<void>;
}

const loginUrl = "https://channels.weixin.qq.com/login.html";
const promoteLoginUrl = "https://channels.weixin.qq.com/login.html?from=promote";
const promoteStatisticUrl =
  "https://channels.weixin.qq.com/promote/pages/platform/short-video/promote-statistic";
const promoteUserPrepareUrl =
  "https://channels.weixin.qq.com/promote/api/web/transfer/MMFinderPromotionDspApisvr/getUserPrepare";
const statisticUrl = "https://channels.weixin.qq.com/platform/playlet/statistic";
const authDataUrl = "https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data";
const statisticListApiName = "get-finder-native-drama-statistics-list";
const promoteOrderListApiName = "searchFeedPromotionOrderList";
const statisticLoadingSelector = ".common-table-loading";
const playletStatisticTaskName = "助手 · 剧集数据处理";
const playletStatisticTaskType = "weixin-channels-playlet-statistic";
const promoteStatisticTaskName = "加热平台 · 数据明细处理";
const promoteStatisticTaskType = "weixin-channels-promote-statistic";
const downloadEventTimeoutMs = 120_000;
const statisticDateApplyMaxAttempts = 3;
const statisticAuthPollIntervalMs = 500;
const statisticResponseTimeoutMs = 60_000;
const settingsStoreKey = "weixin-channels-settings";
const syncLogger = logger.scope("weixin-channels-sync");

const activeJobs = new Map<WeixinChannelsSyncMode, ActiveWeixinSyncJob>();

const defaultSettings: WeixinChannelsSettings = {
  assistantDatePreset: "previous-day",
  promoteDatePreset: "previous-day",
};

export function getWeixinChannelsSettings(): WeixinChannelsSettings {
  return normalizeWeixinChannelsSettings(storeService.get(settingsStoreKey));
}

export function saveWeixinChannelsSettings(settings: unknown): WeixinChannelsSettings {
  const normalized = normalizeWeixinChannelsSettings(settings);
  storeService.set(settingsStoreKey, normalized);
  return normalized;
}

export async function chooseWeixinChannelsDownloadDirectory(): Promise<string | undefined> {
  const current = getWeixinChannelsSettings().downloadDirectory;
  const result = await dialog.showOpenDialog({
    defaultPath: current,
    properties: ["openDirectory", "createDirectory"],
    title: "选择微信视频号文件保存位置",
  });

  return result.canceled ? undefined : result.filePaths[0];
}

export async function openWeixinChannelsDownloadDirectory(): Promise<{
  error?: string;
  path: string;
}> {
  const directory = resolveWeixinChannelsDownloadRoot(getWeixinChannelsSettings());
  await mkdir(directory, { recursive: true });
  const error = await shell.openPath(directory);

  return {
    error: error || undefined,
    path: directory,
  };
}

function normalizeWeixinChannelsSettings(value: unknown): WeixinChannelsSettings {
  const raw = isRecord(value) ? value : {};
  const downloadDirectory =
    typeof raw.downloadDirectory === "string" && raw.downloadDirectory.trim()
      ? path.resolve(raw.downloadDirectory.trim())
      : undefined;

  return {
    assistantCustomDateRange: normalizeCustomDateRange(raw.assistantCustomDateRange),
    assistantDatePreset: normalizeDatePreset(raw.assistantDatePreset),
    downloadDirectory,
    promoteCustomDateRange: normalizeCustomDateRange(raw.promoteCustomDateRange),
    promoteDatePreset: normalizeDatePreset(raw.promoteDatePreset),
  };
}

function normalizeCustomDateRange(value: unknown): WeixinChannelsCustomDateRange | undefined {
  if (!isRecord(value) || !isIsoDate(value.startDate) || !isIsoDate(value.endDate)) {
    return undefined;
  }

  return {
    endDate: value.endDate,
    startDate: value.startDate,
  };
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    dayjs(value).format("YYYY-MM-DD") === value;
}

function normalizeDatePreset(value: unknown): WeixinChannelsDatePreset {
  return value === "today" ||
    value === "last-7-days" ||
    value === "month-to-date" ||
    value === "previous-month" ||
    value === "custom"
    ? value
    : defaultSettings.assistantDatePreset;
}

function resolveWeixinChannelsDownloadRoot(settings: WeixinChannelsSettings): string {
  return settings.downloadDirectory ?? path.join(
    app.getPath("userData"),
    "downloads",
    weixinChannelsPlatform.id,
  );
}

interface ResolvedDateRange {
  endDate: string;
  label: string;
  startDate: string;
}

function resolveDateRange(
  preset: WeixinChannelsDatePreset,
  customRange?: WeixinChannelsCustomDateRange,
): ResolvedDateRange {
  if (preset === "custom") {
    if (!customRange || customRange.endDate < customRange.startDate) {
      throw new Error("自定义日期范围无效，请重新配置开始日期和结束日期");
    }

    return {
      ...customRange,
      label: customRange.startDate === customRange.endDate
        ? customRange.startDate
        : `${customRange.startDate}至${customRange.endDate}`,
    };
  }

  const today = dayjs();
  let start = today;
  let end = today;

  if (preset === "previous-day") {
    start = today.subtract(1, "day");
    end = start;
  } else if (preset === "last-7-days") {
    start = today.subtract(6, "day");
  } else if (preset === "month-to-date") {
    start = today.startOf("month");
  } else if (preset === "previous-month") {
    start = today.subtract(1, "month").startOf("month");
    end = today.subtract(1, "month").endOf("month");
  }

  const startDate = start.format("YYYY-MM-DD");
  const endDate = end.format("YYYY-MM-DD");

  return {
    endDate,
    label: startDate === endDate ? startDate : `${startDate}至${endDate}`,
    startDate,
  };
}

export function startWeixinChannelsSync(
  options: StartWeixinChannelsSyncOptions,
  mode: WeixinChannelsSyncMode = "assistant",
): {
  mode: WeixinChannelsSyncMode;
  running: boolean;
  started: boolean;
} {
  const activeJob = activeJobs.get(mode);
  if (activeJob) {
    syncLogger.info("Weixin Channels sync start requested while job is already running");
    return {
      mode,
      running: true,
      started: false,
    };
  }

  const abortController = new AbortController();
  const runJob = mode === "promote" ? runWeixinPromoteSyncLoop : runWeixinChannelsSyncLoop;
  const promise = runJob(options, abortController.signal)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      syncLogger.error("Weixin Channels sync failed", { error: message });
      options.sendEvent({
        message,
        mode,
        type: "error",
      });
    })
    .finally(() => {
      activeJobs.delete(mode);
      options.sendEvent({
        message: "视频号同步任务已停止",
        mode,
        type: "stopped",
      });
    });

  activeJobs.set(mode, {
    abortController,
    mode,
    promise,
  });

  syncLogger.info("Weixin Channels sync job started", { mode });
  options.sendEvent({
    message: mode === "promote" ? "加热平台数据处理任务已启动" : "助手剧集数据处理任务已启动",
    mode,
    type: "started",
  });

  return {
    mode,
    running: true,
    started: true,
  };
}

export async function stopWeixinChannelsSync(
  mode?: WeixinChannelsSyncMode,
): Promise<{ stopped: boolean }> {
  const selectedJob = mode ? activeJobs.get(mode) : undefined;
  const jobs: ActiveWeixinSyncJob[] = mode
    ? selectedJob
      ? [selectedJob]
      : []
    : [...activeJobs.values()];

  if (jobs.length === 0) {
    syncLogger.info("Weixin Channels sync stop requested without an active job");
    return {
      stopped: false,
    };
  }

  syncLogger.info("Stopping Weixin Channels sync job");
  for (const job of jobs) {
    job.abortController.abort();
  }
  await Promise.all(jobs.map((job) => job.promise));

  return {
    stopped: true,
  };
}

async function runWeixinChannelsSyncLoop(
  options: StartWeixinChannelsSyncOptions,
  signal: AbortSignal,
): Promise<void> {
  const processedUniqIds = new Set<string>();
  const settings = getWeixinChannelsSettings();
  const dateRange = resolveDateRange(
    settings.assistantDatePreset,
    settings.assistantCustomDateRange,
  );
  const environment = loadPlatformAutomationEnvironment();
  const config = loadPlatformRuntimeConfig(weixinChannelsPlatform, "operator-1", environment);
  const profileRoot = path.isAbsolute(config.profileRoot)
    ? config.profileRoot
    : path.resolve(app.getPath("userData"), config.profileRoot);
  const profilePath = path.join(profileRoot, weixinChannelsPlatform.id, "operator-1");
  const downloadDirectory = resolveWeixinChannelsDownloadRoot(settings);
  const temporaryDownloadDirectory = path.join(downloadDirectory, ".playwright");

  await mkdir(downloadDirectory, { recursive: true });
  await mkdir(temporaryDownloadDirectory, { recursive: true });
  syncLogger.info("Weixin Channels sync runtime prepared", {
    downloadDirectory,
    profilePath,
    temporaryDownloadDirectory,
  });

  process.env.PLAYWRIGHT_BROWSERS_PATH = app.isPackaged
    ? path.join(process.resourcesPath, "playwright-browsers")
    : path.join(process.env.APP_ROOT, "build", "playwright-browsers");

  const { chromium } = await import("playwright");
  syncLogger.info("Launching Weixin Channels browser", {
    browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH,
  });
  const context = await chromium.launchPersistentContext(profilePath, {
    acceptDownloads: true,
    downloadsPath: temporaryDownloadDirectory,
    headless: false,
  });
  const page = context.pages()[0] ?? (await context.newPage());

  signal.addEventListener(
    "abort",
    () => {
      void context.close().catch(() => undefined);
    },
    { once: true },
  );

  try {
    while (!signal.aborted) {
      syncLogger.info("Preparing next Weixin Channels login");
      await prepareNextLogin(page);
      options.sendEvent({
        message: "请在打开的微信视频号登录页扫码",
        taskName: playletStatisticTaskName,
        taskType: playletStatisticTaskType,
        type: "waiting-for-scan",
      });

      await waitForLoginPageCompleted(page, signal);
      syncLogger.info("Weixin Channels login page completed; opening statistic page");
      options.sendEvent({
        message: "扫码完成，正在进入数据页确认视频号身份",
        taskName: playletStatisticTaskName,
        taskType: playletStatisticTaskType,
        type: "logged-in",
      });

      syncLogger.info("Opening Weixin Channels statistic page", {
        statisticUrl,
      });
      await page.goto(statisticUrl, {
        waitUntil: "domcontentloaded",
      });
      const [statisticAuthData] = await Promise.all([
        waitForStatisticAuthData(page, signal),
        waitForStatisticPageReady(page),
      ]);
      const { accountName, uniqId } = extractAccountInfo(statisticAuthData);
      const targetDate = dateRange.label;

      if (!uniqId) {
        const failureReason = "未获取到视频号 uniqId，为避免重复处理已跳过";
        syncLogger.warn("Skipping Weixin Channels account without uniqId", {
          accountName,
          targetDate,
        });
        options.sendEvent({
          accountName,
          failureReason,
          message: `处理失败：${accountName}（${failureReason}）`,
          taskName: playletStatisticTaskName,
          taskType: playletStatisticTaskType,
          targetDate,
          timestamp: new Date().toISOString(),
          type: "account-failed",
        });
        await signOutAccount(page, options, { accountName });
        continue;
      }

      if (processedUniqIds.has(uniqId)) {
        const failureReason = "本次任务已处理过该视频号，已跳过重复下载和导入";
        syncLogger.warn("Skipping duplicate Weixin Channels account in current job", {
          accountName,
          targetDate,
          uniqId,
        });
        options.sendEvent({
          accountName,
          failureReason,
          message: `处理失败：${accountName}（${failureReason}）`,
          taskName: playletStatisticTaskName,
          taskType: playletStatisticTaskType,
          targetDate,
          timestamp: new Date().toISOString(),
          type: "account-failed",
          uniqId,
        });
        await signOutAccount(page, options, { accountName, uniqId });
        continue;
      }

      processedUniqIds.add(uniqId);
      syncLogger.info("Registered Weixin Channels account in current job", {
        accountName,
        processedAccountCount: processedUniqIds.size,
        uniqId,
      });

      syncLogger.info("Using Weixin Channels account info for download/import", {
        accountName,
        targetDate,
        uniqId,
      });
      try {
        await setPlayletStatisticDateRangeWithRetry(page, dateRange, signal);
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }

        const failureReason = `目标日期数据加载失败：${error instanceof Error ? error.message : String(error)}`;
        syncLogger.error("Failed to load target Weixin Channels statistic date", {
          accountName,
          error: failureReason,
          targetDate,
          uniqId,
        });
        options.sendEvent({
          accountName,
          failureReason,
          message: `处理失败：${accountName}（${failureReason}）`,
          taskName: playletStatisticTaskName,
          taskType: playletStatisticTaskType,
          targetDate,
          timestamp: new Date().toISOString(),
          type: "account-failed",
          uniqId,
        });
        await signOutAccount(page, options, { accountName, uniqId });
        continue;
      }
      syncLogger.info("Starting Weixin Channels statistic download", {
        accountName,
        targetDate,
        uniqId,
      });
      const download = await downloadStatisticFile(page, targetDate);
      const savedFile = await saveDownloadedFile(download, {
        accountName,
        downloadDirectory,
        filenamePrefix: "助手",
        targetDate,
        uniqId,
      });

      syncLogger.info("Weixin Channels statistic download saved", {
        accountName,
        bytes: savedFile.bytes,
        filePath: savedFile.filePath,
        filename: savedFile.filename,
        suggestedFilename: savedFile.suggestedFilename,
        targetDate,
        uniqId,
      });
      options.sendEvent({
        accountName,
        filePath: savedFile.filePath,
        message: `下载完成：${savedFile.filename}`,
        taskName: playletStatisticTaskName,
        taskType: playletStatisticTaskType,
        targetDate,
        type: "downloaded",
        uniqId,
      });

      syncLogger.info("Importing Weixin Channels file into Daren Center", {
        accountName,
        filePath: savedFile.filePath,
        sourceName: accountName,
        targetDate,
        uniqId,
      });
      const importedAt = new Date().toISOString();
      const importResult = await importDownloadedFile(savedFile, {
        sourceName: accountName,
      });

      syncLogger.info("Weixin Channels import completed", {
        accountName,
        body: importResult.result.body,
        filePath: savedFile.filePath,
        sourceId: importResult.sourceId,
        status: importResult.result.status,
        statusText: importResult.result.statusText,
        targetDate,
        uniqId,
      });
      options.sendEvent({
        accountName,
        filename: savedFile.filename,
        filePath: savedFile.filePath,
        message: `导入完成：${accountName}`,
        sourceId: importResult.sourceId,
        taskName: playletStatisticTaskName,
        taskType: playletStatisticTaskType,
        targetDate,
        timestamp: importedAt,
        type: "imported",
        uniqId,
        result: importResult.result.body,
      });

      await signOutAccount(page, options, { accountName, uniqId });
    }
  } finally {
    syncLogger.info("Closing Weixin Channels browser context");
    await context.close().catch(() => undefined);
  }
}

async function runWeixinPromoteSyncLoop(
  options: StartWeixinChannelsSyncOptions,
  signal: AbortSignal,
): Promise<void> {
  const processedUniqIds = new Set<string>();
  const settings = getWeixinChannelsSettings();
  const dateRange = resolveDateRange(
    settings.promoteDatePreset,
    settings.promoteCustomDateRange,
  );
  const environment = loadPlatformAutomationEnvironment();
  const config = loadPlatformRuntimeConfig(weixinChannelsPlatform, "operator-1", environment);
  const profileRoot = path.isAbsolute(config.profileRoot)
    ? config.profileRoot
    : path.resolve(app.getPath("userData"), config.profileRoot);
  const profilePath = path.join(profileRoot, weixinChannelsPlatform.id, "promote-operator-1");
  const downloadDirectory = settings.downloadDirectory
    ? resolveWeixinChannelsDownloadRoot(settings)
    : path.join(resolveWeixinChannelsDownloadRoot(settings), "promote");
  const temporaryDownloadDirectory = path.join(downloadDirectory, ".playwright");

  await mkdir(downloadDirectory, { recursive: true });
  await mkdir(temporaryDownloadDirectory, { recursive: true });
  syncLogger.info("Weixin Channels promote runtime prepared", {
    downloadDirectory,
    profilePath,
    temporaryDownloadDirectory,
  });

  process.env.PLAYWRIGHT_BROWSERS_PATH = app.isPackaged
    ? path.join(process.resourcesPath, "playwright-browsers")
    : path.join(process.env.APP_ROOT, "build", "playwright-browsers");

  const { chromium } = await import("playwright");
  const context = await chromium.launchPersistentContext(profilePath, {
    acceptDownloads: true,
    downloadsPath: temporaryDownloadDirectory,
    headless: false,
  });
  const page = context.pages()[0] ?? (await context.newPage());

  signal.addEventListener(
    "abort",
    () => {
      void context.close().catch(() => undefined);
    },
    { once: true },
  );

  try {
    while (!signal.aborted) {
      syncLogger.info("Preparing next Weixin Channels promote login");
      await prepareNextLogin(page, promoteLoginUrl);
      options.sendEvent({
        message: "请在打开的微信视频号加热平台登录页扫码",
        mode: "promote",
        taskName: promoteStatisticTaskName,
        taskType: promoteStatisticTaskType,
        type: "waiting-for-scan",
      });

      await waitForLoginPageCompleted(page, signal);
      options.sendEvent({
        message: "扫码完成，正在进入加热平台数据明细页",
        mode: "promote",
        taskName: promoteStatisticTaskName,
        taskType: promoteStatisticTaskType,
        type: "logged-in",
      });

      syncLogger.info("Opening Weixin Channels promote statistic page", {
        promoteStatisticUrl,
      });
      await page.goto(promoteStatisticUrl, {
        waitUntil: "domcontentloaded",
      });
      await waitForPromoteStatisticPageReady(page);
      const { accountName, uniqId } = await fetchPromoteAccountInfo(page);
      const targetDate = dateRange.label;

      if (!uniqId || processedUniqIds.has(uniqId)) {
        const failureReason = !uniqId
          ? "未获取到视频号 uniqId，为避免重复处理已跳过"
          : "本次任务已处理过该视频号，已跳过重复下载";
        options.sendEvent({
          accountName,
          failureReason,
          message: `处理失败：${accountName}（${failureReason}）`,
          mode: "promote",
          taskName: promoteStatisticTaskName,
          taskType: promoteStatisticTaskType,
          targetDate,
          timestamp: new Date().toISOString(),
          type: "account-failed",
          uniqId: uniqId || undefined,
        });
        await signOutAccount(
          page,
          options,
          { accountName, uniqId: uniqId || undefined },
          { mode: "promote", taskName: promoteStatisticTaskName, taskType: promoteStatisticTaskType },
        );
        continue;
      }

      processedUniqIds.add(uniqId);
      syncLogger.info("Registered Weixin Channels promote account in current job", {
        accountName,
        processedAccountCount: processedUniqIds.size,
        uniqId,
      });

      try {
        await setPromoteStatisticDateRangeWithRetry(page, dateRange, signal);
      } catch (error) {
        if (signal.aborted) {
          throw error;
        }

        const failureReason = `目标日期数据加载失败：${error instanceof Error ? error.message : String(error)}`;
        options.sendEvent({
          accountName,
          failureReason,
          message: `处理失败：${accountName}（${failureReason}）`,
          mode: "promote",
          taskName: promoteStatisticTaskName,
          taskType: promoteStatisticTaskType,
          targetDate,
          timestamp: new Date().toISOString(),
          type: "account-failed",
          uniqId,
        });
        await signOutAccount(
          page,
          options,
          { accountName, uniqId },
          { mode: "promote", taskName: promoteStatisticTaskName, taskType: promoteStatisticTaskType },
        );
        continue;
      }

      const download = await downloadPromoteStatisticFile(page, targetDate);
      const savedFile = await saveDownloadedFile(download, {
        accountName,
        downloadDirectory,
        filenamePrefix: "加热平台",
        targetDate,
        uniqId,
      });
      syncLogger.info("Weixin Channels promote statistic download saved", {
        accountName,
        bytes: savedFile.bytes,
        filePath: savedFile.filePath,
        filename: savedFile.filename,
        targetDate,
        uniqId,
      });
      options.sendEvent({
        accountName,
        filePath: savedFile.filePath,
        message: `加热平台数据下载完成：${savedFile.filename}`,
        mode: "promote",
        taskName: promoteStatisticTaskName,
        taskType: promoteStatisticTaskType,
        targetDate,
        type: "downloaded",
        uniqId,
      });

      const importedAt = new Date().toISOString();
      const importResult = await importPromoteStatisticFile(savedFile, {
        accountName,
        uniqId,
      });
      options.sendEvent({
        accountName,
        filename: savedFile.filename,
        filePath: savedFile.filePath,
        message: `加热平台数据导入完成：${accountName}`,
        mode: "promote",
        taskName: promoteStatisticTaskName,
        taskType: promoteStatisticTaskType,
        targetDate,
        timestamp: importedAt,
        type: "imported",
        uniqId,
        result: importResult.body,
      });

      await signOutAccount(
        page,
        options,
        { accountName, uniqId },
        { mode: "promote", taskName: promoteStatisticTaskName, taskType: promoteStatisticTaskType },
      );
    }
  } finally {
    syncLogger.info("Closing Weixin Channels promote browser context");
    await context.close().catch(() => undefined);
  }
}

async function prepareNextLogin(page: Page, targetLoginUrl = loginUrl): Promise<void> {
  syncLogger.info("Clearing cookies and storage before login page");
  await clearLoginState(page);
  syncLogger.info("Navigating to Weixin Channels login page", { loginUrl: targetLoginUrl });
  await page.goto(targetLoginUrl, {
    waitUntil: "domcontentloaded",
  });
}

async function waitForStatisticPageReady(page: Page): Promise<void> {
  syncLogger.info("Waiting for Weixin Channels statistic page to finish loading");

  await page.waitForLoadState("domcontentloaded", {
    timeout: 30_000,
  });

  await page.getByText("下载数据").waitFor({
    state: "visible",
    timeout: 180_000,
  });

  syncLogger.info("Weixin Channels statistic page outer download button is visible");
}

async function setPlayletStatisticDateRange(page: Page, range: ResolvedDateRange): Promise<void> {
  syncLogger.info("Setting Weixin Channels playlet statistic date range", {
    endDate: range.endDate,
    startDate: range.startDate,
  });

  const dateRange = await findPlayletStatisticDateRange(page);

  syncLogger.info("Weixin Channels playlet statistic date inputs located", {
    scope: dateRange.scope,
  });

  await waitForStatisticLoadingDetached(page, "before date range change");

  const expectedRange = getStatisticTimestampRange(range);
  syncLogger.info("Waiting for target Weixin Channels statistic response", {
    endTs: expectedRange.endTs,
    startTs: expectedRange.startTs,
    targetDate: range.label,
  });
  const targetResponsePromise = page.waitForResponse(
    (response) => {
      if (!isStatisticListRequest(response.request())) {
        return false;
      }

      const body = parseStatisticRequestBody(response.request());
      const matchesTarget = Boolean(
        body &&
          String(body.startTs) === expectedRange.startTs &&
          String(body.endTs) === expectedRange.endTs,
      );

      syncLogger.info("Observed Weixin Channels statistic response", {
        currentPage: body?.currentPage,
        endTs: body?.endTs,
        matchesTarget,
        startTs: body?.startTs,
        status: response.status(),
        targetEndTs: expectedRange.endTs,
        targetStartTs: expectedRange.startTs,
      });

      return matchesTarget;
    },
    {
      timeout: statisticResponseTimeoutMs,
    },
  );

  const onStatisticRequest = (request: Request) => {
    if (!isStatisticListRequest(request)) {
      return;
    }

    const body = parseStatisticRequestBody(request);
    syncLogger.info("Observed Weixin Channels statistic request", {
      currentPage: body?.currentPage,
      endTs: body?.endTs,
      startTs: body?.startTs,
      targetEndTs: expectedRange.endTs,
      targetStartTs: expectedRange.startTs,
    });
  };
  page.on("request", onStatisticRequest);

  let targetResponse: Response;
  try {
    [targetResponse] = await Promise.all([
      targetResponsePromise,
      setDateRangeInputsDirectly(dateRange.root, range),
    ]);
  } finally {
    page.off("request", onStatisticRequest);
  }

  const [actualStartDate, actualEndDate] = await Promise.all([
    dateRange.startInput.inputValue(),
    dateRange.endInput.inputValue(),
  ]);

  if (actualStartDate !== range.startDate || actualEndDate !== range.endDate) {
    throw new Error(
      `视频号剧集统计日期设置失败：期望 ${range.startDate} 至 ${range.endDate}，实际 ${actualStartDate || "空"} 至 ${
        actualEndDate || "空"
      }`,
    );
  }

  if (!targetResponse.ok()) {
    throw new Error(
      `视频号剧集统计数据请求失败：HTTP ${targetResponse.status()} ${targetResponse.statusText()}`,
    );
  }

  const responseFailure = await targetResponse.finished();
  if (responseFailure) {
    throw new Error(`视频号剧集统计数据响应接收失败：${responseFailure.message}`);
  }

  await assertStatisticResponseSucceeded(targetResponse);
  await waitForStatisticLoadingDetached(page, "after target date response");

  await page.getByText("下载数据").waitFor({
    state: "visible",
    timeout: statisticResponseTimeoutMs,
  });

  syncLogger.info("Weixin Channels playlet statistic date range applied", {
    endDate: actualEndDate,
    endTs: expectedRange.endTs,
    startDate: actualStartDate,
    startTs: expectedRange.startTs,
  });
}

async function setPlayletStatisticDateRangeWithRetry(
  page: Page,
  range: ResolvedDateRange,
  signal: AbortSignal,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= statisticDateApplyMaxAttempts; attempt += 1) {
    try {
      await setPlayletStatisticDateRange(page, range);
      return;
    } catch (error) {
      lastError = error;
      syncLogger.warn("Weixin Channels target date loading attempt failed", {
        attempt,
        error: error instanceof Error ? error.message : String(error),
        maxAttempts: statisticDateApplyMaxAttempts,
        targetDate: range.label,
      });

      if (signal.aborted || attempt === statisticDateApplyMaxAttempts) {
        break;
      }

      await wait(1_000, signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

interface StatisticTimestampRange {
  endTs: string;
  startTs: string;
}

function getStatisticTimestampRange(range: ResolvedDateRange): StatisticTimestampRange {
  const startMilliseconds = Date.parse(`${range.startDate}T00:00:00+08:00`);
  const endMilliseconds = Date.parse(`${range.endDate}T00:00:00+08:00`);

  if (!Number.isFinite(startMilliseconds) || !Number.isFinite(endMilliseconds)) {
    throw new Error(`无法计算视频号统计日期时间戳：${range.label}`);
  }

  const startTs = Math.floor(startMilliseconds / 1_000);

  return {
    endTs: String(Math.floor(endMilliseconds / 1_000)),
    startTs: String(startTs),
  };
}

function isStatisticListRequest(request: Request): boolean {
  return request.method() === "POST" && request.url().includes(statisticListApiName);
}

function parseStatisticRequestBody(request: Request): Record<string, unknown> | undefined {
  const postData = request.postData();

  if (!postData) {
    return undefined;
  }

  try {
    const body: unknown = JSON.parse(postData);
    return isRecord(body) ? body : undefined;
  } catch {
    return undefined;
  }
}

async function assertStatisticResponseSucceeded(response: Response): Promise<void> {
  let body: unknown;

  try {
    body = await response.json();
  } catch (error) {
    throw new Error(
      `视频号剧集统计数据响应不是有效 JSON：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(body)) {
    throw new Error("视频号剧集统计数据响应格式无效");
  }

  const errorCode = getStatisticResponseErrorCode(body);
  if (errorCode !== undefined && errorCode !== 0) {
    throw new Error(`视频号剧集统计数据接口返回失败状态：${errorCode}`);
  }
}

function getStatisticResponseErrorCode(body: Record<string, unknown>): number | undefined {
  for (const key of ["errCode", "err_code"]) {
    const value = body[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  for (const key of ["baseResp", "base_resp"]) {
    const value = body[key];
    if (!isRecord(value)) {
      continue;
    }

    for (const errorKey of ["errCode", "err_code", "ret"]) {
      const errorCode = value[errorKey];
      if (typeof errorCode === "number" && Number.isFinite(errorCode)) {
        return errorCode;
      }
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function waitForStatisticLoadingDetached(page: Page, stage: string): Promise<void> {
  syncLogger.info("Waiting for Weixin Channels statistic loading to disappear", {
    stage,
  });
  await page.locator(statisticLoadingSelector).waitFor({
    state: "detached",
    timeout: statisticResponseTimeoutMs,
  });
  syncLogger.info("Weixin Channels statistic loading disappeared", {
    stage,
  });
}

function getPromoteStatisticLoading(page: Page): Locator {
  return page
    .locator("div.absolute.bottom-0.left-0.right-0.top-0")
    .filter({ has: page.locator("svg.loading.animate-spin") });
}

function getPromoteDownloadControl(page: Page): Locator {
  return page
    .getByRole("button", { name: /导出|下载/ })
    .or(page.getByText(/导出|下载/))
    .first();
}

function isPromoteOrderListRequest(request: Request): boolean {
  return request.method() === "POST" && request.url().includes(promoteOrderListApiName);
}

function getPromoteTimestampRange(range: ResolvedDateRange): {
  endTs: string;
  startTs: string;
} {
  const startMilliseconds = Date.parse(`${range.startDate}T00:00:00+08:00`);
  const endMilliseconds = Date.parse(`${range.endDate}T23:59:59+08:00`);

  if (!Number.isFinite(startMilliseconds) || !Number.isFinite(endMilliseconds)) {
    throw new Error(`无法转换加热平台目标日期：${range.label}`);
  }

  return {
    endTs: String(Math.floor(endMilliseconds / 1_000)),
    startTs: String(Math.floor(startMilliseconds / 1_000)),
  };
}

function doesPromoteOrderListMatchDateRange(request: Request, range: ResolvedDateRange): boolean {
  const body = parseStatisticRequestBody(request);
  const expectedRange = getPromoteTimestampRange(range);

  return Boolean(
    body &&
      String(body.createTsMin) === expectedRange.startTs &&
      String(body.createTsMax) === expectedRange.endTs &&
      Number(body.page) === 1,
  );
}

async function setPromoteDateRangeDirectly(
  root: Locator,
  range: ResolvedDateRange,
): Promise<void> {
  const result = await root.evaluate((element, value) => {
    type VueVNode = {
      children?: unknown;
      component?: VueComponentInstance | null;
      dynamicChildren?: VueVNode[] | null;
      el?: Element | null;
      suspense?: { activeBranch?: VueVNode | null } | null;
    };
    type VueComponentInstance = {
      emit?: (event: string, ...args: unknown[]) => void;
      parent?: VueComponentInstance | null;
      subTree?: VueVNode | null;
      type?: { __name?: string; name?: string };
      vnode?: { props?: Record<string, unknown> | null };
    };
    type ElementWithVue3 = Element & {
      __vueParentComponent?: VueComponentInstance;
    };
    type VueAppContainer = Element & {
      __vue_app__?: { _instance?: VueComponentInstance | null };
      _vnode?: VueVNode | null;
    };

    const startMilliseconds = Date.parse(`${value.startDate}T00:00:00+08:00`);
    const endMilliseconds = Date.parse(`${value.endDate}T00:00:00+08:00`);
    const timestamps = [startMilliseconds, endMilliseconds];
    const componentQueue: VueComponentInstance[] = [];
    const directComponent = (element as ElementWithVue3).__vueParentComponent;
    if (directComponent) {
      componentQueue.push(directComponent);
    }

    const visitedComponents = new Set<VueComponentInstance>();
    const visitedVNodes = new Set<VueVNode>();
    const visitedNames: string[] = [];
    const discoveredVueKeys = new Set<string>();
    const collectVNodeComponents = (node: unknown) => {
      if (!node || typeof node !== "object" || visitedVNodes.has(node as VueVNode)) {
        return;
      }

      const vnode = node as VueVNode;
      visitedVNodes.add(vnode);
      if (vnode.component) {
        componentQueue.push(vnode.component);
      }
      if (Array.isArray(vnode.children)) {
        vnode.children.forEach(collectVNodeComponents);
      }
      vnode.dynamicChildren?.forEach(collectVNodeComponents);
      collectVNodeComponents(vnode.suspense?.activeBranch);
    };

    const candidateElements = [document.documentElement, document.body, ...document.querySelectorAll("*")];
    for (const candidateElement of candidateElements) {
      const vueElement = candidateElement as VueAppContainer & ElementWithVue3;
      if (vueElement.__vueParentComponent) {
        componentQueue.push(vueElement.__vueParentComponent);
      }
      if (vueElement.__vue_app__?._instance) {
        componentQueue.push(vueElement.__vue_app__._instance);
      }
      collectVNodeComponents(vueElement._vnode);

      for (const propertyName of Object.getOwnPropertyNames(candidateElement)) {
        if (!/vue|vnode/i.test(propertyName)) {
          continue;
        }

        discoveredVueKeys.add(propertyName);
        const propertyValue = (candidateElement as unknown as Record<string, unknown>)[propertyName];
        if (/parentcomponent/i.test(propertyName) && propertyValue) {
          componentQueue.push(propertyValue as VueComponentInstance);
        } else if (/vue.*app/i.test(propertyName)) {
          const appInstance = (propertyValue as { _instance?: VueComponentInstance | null } | null)
            ?._instance;
          if (appInstance) {
            componentQueue.push(appInstance);
          }
        } else if (/vnode/i.test(propertyName)) {
          collectVNodeComponents(propertyValue);
        }
      }
    }

    while (componentQueue.length > 0) {
      const component = componentQueue.shift();
      if (!component || visitedComponents.has(component)) {
        continue;
      }

      visitedComponents.add(component);
      const componentName = component.type?.name ?? component.type?.__name ?? "anonymous";
      if (visitedNames.length < 40) {
        visitedNames.push(componentName);
      }
      if (/MpDateRangePicker/i.test(componentName)) {
        if (component.emit) {
          component.emit("change", timestamps);
          return { componentName, method: "emit", visitedNames };
        }

        const onChange = component.vnode?.props?.onChange;
        if (typeof onChange === "function") {
          onChange(timestamps);
          return { componentName, method: "vnode.onChange", visitedNames };
        }
      }

      collectVNodeComponents(component.subTree);
    }

    throw new Error(
      `Unable to locate MpDateRangePicker Vue component; Vue keys: ${[
        ...discoveredVueKeys,
      ].join(", ")}; visited: ${visitedNames.join(", ")}`,
    );
  }, range);

  syncLogger.info("Updated Weixin Channels promote Vue date range", result);
}

async function waitForPromoteStatisticPageReady(page: Page): Promise<void> {
  syncLogger.info("Waiting for Weixin Channels promote statistic page to finish loading");
  await page.waitForLoadState("domcontentloaded", {
    timeout: 30_000,
  });

  const dateRange = page.locator(".orderlist-filter-container .date-range-picker").first();
  await Promise.all([
    dateRange.locator('input[placeholder="开始日期"]').waitFor({
      state: "visible",
      timeout: 180_000,
    }),
    dateRange.locator('input[placeholder="结束日期"]').waitFor({
      state: "visible",
      timeout: 180_000,
    }),
  ]);
  syncLogger.info("Weixin Channels promote date inputs are visible");
  await getPromoteStatisticLoading(page).waitFor({
    state: "detached",
    timeout: statisticResponseTimeoutMs,
  });
  syncLogger.info("Weixin Channels promote statistic page is ready");
}

async function setPromoteStatisticDateRange(page: Page, range: ResolvedDateRange): Promise<void> {
  const root = page.locator(".orderlist-filter-container .date-range-picker").first();
  const startInput = root.locator('input[placeholder="开始日期"]').first();
  const endInput = root.locator('input[placeholder="结束日期"]').first();
  const loading = getPromoteStatisticLoading(page);

  await loading.waitFor({
    state: "detached",
    timeout: statisticResponseTimeoutMs,
  });

  syncLogger.info("Setting Weixin Channels promote statistic date range", {
    endDate: range.endDate,
    startDate: range.startDate,
  });
  const expectedRange = getPromoteTimestampRange(range);
  syncLogger.info("Waiting for target Weixin Channels promote order list response", {
    endTs: expectedRange.endTs,
    startTs: expectedRange.startTs,
  });
  const targetResponsePromise = page.waitForResponse(
    (response) =>
      isPromoteOrderListRequest(response.request()) &&
      doesPromoteOrderListMatchDateRange(response.request(), range),
    { timeout: statisticResponseTimeoutMs },
  );
  const [targetResponse] = await Promise.all([
    targetResponsePromise,
    setPromoteDateRangeDirectly(root, range),
  ]);

  const [actualStartDate, actualEndDate] = await Promise.all([
    startInput.inputValue(),
    endInput.inputValue(),
  ]);
  if (actualStartDate !== range.startDate || actualEndDate !== range.endDate) {
    throw new Error(
      `加热平台日期设置失败：期望 ${range.startDate} 至 ${range.endDate}，实际 ${actualStartDate || "空"} 至 ${actualEndDate || "空"}`,
    );
  }

  if (!targetResponse.ok()) {
    throw new Error(
      `加热平台目标日期数据请求失败：HTTP ${targetResponse.status()} ${targetResponse.statusText()}`,
    );
  }

  const responseFailure = await targetResponse.finished();
  if (responseFailure) {
    throw new Error(`加热平台目标日期数据响应接收失败：${responseFailure.message}`);
  }
  await assertStatisticResponseSucceeded(targetResponse);

  await loading.waitFor({
    state: "detached",
    timeout: statisticResponseTimeoutMs,
  });
  await getPromoteDownloadControl(page).waitFor({
    state: "visible",
    timeout: statisticResponseTimeoutMs,
  });
  syncLogger.info("Weixin Channels promote statistic date range applied", {
    endDate: actualEndDate,
    startDate: actualStartDate,
  });
}

async function setPromoteStatisticDateRangeWithRetry(
  page: Page,
  range: ResolvedDateRange,
  signal: AbortSignal,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= statisticDateApplyMaxAttempts; attempt += 1) {
    try {
      await setPromoteStatisticDateRange(page, range);
      return;
    } catch (error) {
      lastError = error;
      syncLogger.warn("Weixin Channels promote target date loading attempt failed", {
        attempt,
        error: error instanceof Error ? error.message : String(error),
        maxAttempts: statisticDateApplyMaxAttempts,
        targetDate: range.label,
      });
      if (signal.aborted || attempt === statisticDateApplyMaxAttempts) {
        break;
      }
      await wait(1_000, signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function findPlayletStatisticDateRange(page: Page): Promise<{
  endInput: Locator;
  root: Locator;
  scope: string;
  startInput: Locator;
}> {
  const singlePlayletBlock = page
    .locator(".block-title", {
      hasText: "单条剧集数据",
    })
    .locator("xpath=..");

  const candidates = [
    {
      root: singlePlayletBlock.locator(".weui-desktop-picker__date-range").first(),
      scope: "single-playlet-data-block",
    },
    {
      root: page.locator(".filter-wrapper .weui-desktop-picker__date-range").first(),
      scope: "filter-wrapper",
    },
    {
      root: page.locator(".weui-desktop-picker__date-range").first(),
      scope: "first-date-range",
    },
  ];

  for (const candidate of candidates) {
    const startInput = candidate.root.locator('input[placeholder="开始日期"]').first();
    const endInput = candidate.root.locator('input[placeholder="结束日期"]').first();
    const [startCount, endCount] = await Promise.all([startInput.count(), endInput.count()]);

    syncLogger.info("Checking Weixin Channels date range inputs", {
      endCount,
      scope: candidate.scope,
      startCount,
    });

    if (startCount === 0 || endCount === 0) {
      continue;
    }

    try {
      await Promise.all([
        startInput.waitFor({
          state: "visible",
          timeout: 15_000,
        }),
        endInput.waitFor({
          state: "visible",
          timeout: 15_000,
        }),
      ]);

      return {
        endInput,
        root: candidate.root,
        scope: candidate.scope,
        startInput,
      };
    } catch (error) {
      syncLogger.warn("Weixin Channels date range inputs found but not visible", {
        error: error instanceof Error ? error.message : String(error),
        scope: candidate.scope,
      });
    }
  }

  throw new Error("未找到视频号剧集统计开始日期和结束日期输入框");
}

async function setDateRangeInputsDirectly(
  dateRange: Locator,
  range: ResolvedDateRange,
): Promise<void> {
  const result = await dateRange.evaluate(async (root, value) => {
    type VueLike = {
      $children?: VueLike[];
      $emit?: (event: string, ...args: unknown[]) => void;
      $forceUpdate?: () => void;
      [key: string]: unknown;
    };
    type ElementWithVue = Element & {
      __vue__?: VueLike;
    };

    const inputs = [
      root.querySelector<HTMLInputElement>('input[placeholder="开始日期"]'),
      root.querySelector<HTMLInputElement>('input[placeholder="结束日期"]'),
    ];

    const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

    if (!valueDescriptor?.set) {
      throw new Error("Unable to resolve HTMLInputElement value setter");
    }

    const applyInputValue = (input: HTMLInputElement, dateValue: string) => {
      input.removeAttribute("readonly");
      input.setAttribute("value", dateValue);
      input.dataset.manualValue = dateValue;
      valueDescriptor.set?.call(input, dateValue);
    };

    const inputValues = [value.startDate, value.endDate];
    for (const [index, input] of inputs.entries()) {
      if (!input) {
        throw new Error("Date range input was not found");
      }

      applyInputValue(input, inputValues[index] ?? value.startDate);
    }

    const changedVuePaths: string[] = [];
    const isDateLikeString = (nextValue: unknown): nextValue is string =>
      typeof nextValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(nextValue);
    const maybeReplaceVueDates = (
      target: unknown,
      path: string,
      visited: WeakSet<object>,
      depth: number,
      scalarDate: string,
    ) => {
      if (!target || typeof target !== "object" || visited.has(target) || depth > 5) {
        return;
      }

      visited.add(target);

      if (Array.isArray(target)) {
        if (target.length >= 2 && target.some(isDateLikeString)) {
          target.splice(0, target.length, value.startDate, value.endDate);
          changedVuePaths.push(path);
          return;
        }

        target.forEach((item, index) => {
          maybeReplaceVueDates(item, `${path}[${index}]`, visited, depth + 1, scalarDate);
        });
        return;
      }

      for (const key of Object.keys(target)) {
        if (key.startsWith("_") || key.startsWith("$")) {
          continue;
        }

        const record = target as Record<string, unknown>;
        const current = record[key];
        const nextPath = path ? `${path}.${key}` : key;

        if (isDateLikeString(current)) {
          record[key] = scalarDate;
          changedVuePaths.push(nextPath);
          continue;
        }

        maybeReplaceVueDates(current, nextPath, visited, depth + 1, scalarDate);
      }
    };

    const vueRoots = new Set<VueLike>();
    root.querySelectorAll("*").forEach((element) => {
      const vue = (element as ElementWithVue).__vue__;

      if (vue) {
        vueRoots.add(vue);
      }
    });

    const rootVue = (root as ElementWithVue).__vue__;

    if (rootVue) {
      vueRoots.add(rootVue);
    }

    let vueIndex = 0;
    for (const vue of vueRoots) {
      const scalarDate = vueIndex === 0 ? value.startDate : value.endDate;
      maybeReplaceVueDates(vue, `vue[${vueIndex}]`, new WeakSet<object>(), 0, scalarDate);
      vue.$emit?.("input", [value.startDate, value.endDate]);
      vue.$emit?.("change", [value.startDate, value.endDate]);
      vue.$forceUpdate?.();
      vueIndex += 1;
    }

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    for (const [index, input] of inputs.entries()) {
      if (!input) {
        continue;
      }

      const inputValue = inputValues[index] ?? value.startDate;
      applyInputValue(input, inputValue);
      input.focus();
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertReplacementText",
        }),
      );
      input.dispatchEvent(
        new Event("change", {
          bubbles: true,
          composed: true,
        }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          composed: true,
          key: "Enter",
        }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keyup", {
          bubbles: true,
          composed: true,
          key: "Enter",
        }),
      );
      input.blur();
      applyInputValue(input, inputValue);
    }

    root.dispatchEvent(
      new Event("change", {
        bubbles: true,
        composed: true,
      }),
    );

    return {
      changedVuePaths: changedVuePaths.slice(0, 20),
      endDate: inputs[1]?.value ?? "",
      startDate: inputs[0]?.value ?? "",
      vueRootCount: vueRoots.size,
    };
  }, range);

  syncLogger.info("Weixin Channels date range inputs updated directly", result);
}

async function waitForLoginPageCompleted(page: Page, signal: AbortSignal): Promise<void> {
  syncLogger.info("Waiting for Weixin Channels login page to leave QR login state");

  await Promise.race([
    page.waitForURL(
      (url) => !url.href.includes("/login.html") && !url.href.includes("/platform/login"),
      {
        timeout: 0,
      },
    ),
    waitForAbort(signal),
  ]);
}

async function waitForStatisticAuthData(page: Page, signal: AbortSignal): Promise<WeixinAuthData> {
  const deadline = Date.now() + 45_000;
  let fallbackAuthData: WeixinAuthData | undefined;

  while (!signal.aborted && Date.now() < deadline) {
    const authData = await fetchAuthData(page);

    if (authData.errCode === 0 && authData.data?.finderUser?.nickname) {
      fallbackAuthData = authData;
    }

    if (isStableFinderUser(authData)) {
      return authData;
    }

    await wait(statisticAuthPollIntervalMs, signal);
  }

  if (fallbackAuthData) {
    syncLogger.warn(
      "Using fallback Weixin Channels auth_data because stable finder user was not available",
    );
    return fallbackAuthData;
  }

  throw new Error("视频号账号信息等待已停止");
}

async function fetchAuthData(page: Page): Promise<WeixinAuthData> {
  return page.evaluate(async (url) => {
    try {
      const response = await fetch(url, {
        body: "{}",
        cache: "no-cache",
        credentials: "include",
        headers: {
          accept: "*/*",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          "cache-control": "no-cache",
          "content-type": "application/json",
          pragma: "no-cache",
        },
        method: "POST",
        mode: "cors",
      });

      return (await response.json()) as WeixinAuthData;
    } catch (error) {
      return {
        errCode: -1,
        errMsg: error instanceof Error ? error.message : String(error),
      } satisfies WeixinAuthData;
    }
  }, authDataUrl);
}

function extractAccountInfo(authData: WeixinAuthData): {
  accountName: string;
  uniqId: string;
} {
  const finderUser = authData.data?.finderUser;

  return {
    accountName: finderUser?.nickname ?? authData.data?.userAttr?.nickname ?? "视频号账号",
    uniqId: finderUser?.uniqId?.trim() ?? "",
  };
}

async function fetchPromoteAccountInfo(page: Page): Promise<{
  accountName: string;
  uniqId: string;
}> {
  syncLogger.info("Requesting Weixin Channels promote account info");
  const result = await page.evaluate(async (url) => {
    try {
      const response = await fetch(url, {
        body: "{}",
        cache: "no-cache",
        credentials: "include",
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          "cache-control": "no-cache",
          "content-type": "application/json",
          pragma: "no-cache",
          "promote-biz-id": "0",
        },
        method: "POST",
        mode: "cors",
      });
      const body = (await response.json().catch(() => undefined)) as unknown;

      return {
        body,
        error: "",
        status: response.status,
      };
    } catch (error) {
      return {
        body: undefined,
        error: error instanceof Error ? error.message : String(error),
        status: 0,
      };
    }
  }, promoteUserPrepareUrl);

  if (result.error) {
    throw new Error(`加热平台账号信息请求失败：${result.error}`);
  }
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`加热平台账号信息请求失败：HTTP ${result.status}`);
  }
  if (!isRecord(result.body) || !isRecord(result.body.data)) {
    throw new Error("加热平台账号信息响应格式异常");
  }

  const accountId = result.body.data.accountId;
  if (typeof accountId !== "string" || !accountId.trim()) {
    throw new Error("加热平台账号信息响应中缺少 accountId");
  }

  const corporateUserInfo = result.body.data.corporateUserInfo;
  const corporateInfo = isRecord(corporateUserInfo)
    ? corporateUserInfo.corporateInfo
    : undefined;
  const accountNameCandidates = isRecord(corporateInfo)
    ? [corporateInfo.finderNickname, corporateInfo.nickname, corporateInfo.corporateName]
    : [];
  const accountName =
    accountNameCandidates.find(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.trim().length > 0,
    )?.trim() ?? "加热平台账号";
  const uniqId = accountId.trim();

  syncLogger.info("Resolved Weixin Channels promote account from getUserPrepare", {
    accountId: uniqId,
    accountName,
  });

  return { accountName, uniqId };
}

async function signOutAccount(
  page: Page,
  options: StartWeixinChannelsSyncOptions,
  account: {
    accountName: string;
    uniqId?: string;
  },
  task: {
    mode: WeixinChannelsSyncMode;
    taskName: string;
    taskType: string;
  } = {
    mode: "assistant",
    taskName: playletStatisticTaskName,
    taskType: playletStatisticTaskType,
  },
): Promise<void> {
  syncLogger.info("Clearing Weixin Channels login state", account);
  await clearLoginState(page);
  options.sendEvent({
    accountName: account.accountName,
    message: `已退出登录：${account.accountName}`,
    mode: task.mode,
    taskName: task.taskName,
    taskType: task.taskType,
    type: "signed-out",
    uniqId: account.uniqId,
  });
}

function isStableFinderUser(authData: WeixinAuthData): boolean {
  const finderUser = authData.data?.finderUser;
  const nickname = finderUser?.nickname?.trim();
  const uniqId = finderUser?.uniqId?.trim();

  return Boolean(authData.errCode === 0 && nickname && uniqId && !/^用户\d+$/.test(nickname));
}

async function downloadStatisticFile(page: Page, targetDate: string): Promise<Download> {
  const outerDownload = await clickAndMaybeDownload(
    page,
    () => page.getByText("下载数据").click({ timeout: 120_000 }),
    "outer download data button",
    targetDate,
  );

  if (outerDownload) {
    return outerDownload;
  }

  throw new Error("点击页面外层下载数据后没有捕获到浏览器下载事件");
}

async function downloadPromoteStatisticFile(page: Page, targetDate: string): Promise<Download> {
  const download = await clickAndMaybeDownload(
    page,
    () => getPromoteDownloadControl(page).click({ timeout: 120_000 }),
    "promote statistic download control",
    targetDate,
  );

  if (download) {
    return download;
  }

  throw new Error("点击加热平台数据下载按钮后没有捕获到浏览器下载事件");
}

async function clickAndMaybeDownload(
  page: Page,
  click: () => Promise<void>,
  label: string,
  targetDate: string,
): Promise<Download | undefined> {
  syncLogger.info(`Clicking ${label} and listening for download event`);

  const downloadPromise = page
    .waitForEvent("download", {
      timeout: downloadEventTimeoutMs,
    })
    .catch(() => undefined);

  await click();

  const download = await downloadPromise;

  if (!download) {
    syncLogger.info(`No browser download event captured from ${label}`);
    return undefined;
  }

  const failure = await download.failure();

  if (failure) {
    throw new Error(`视频号数据下载失败：${failure}`);
  }

  syncLogger.info("Browser download event received", {
    suggestedFilename: download.suggestedFilename(),
    targetDate,
    url: download.url(),
  });

  return download;
}

async function saveDownloadedFile(
  download: Download,
  options: {
    accountName: string;
    downloadDirectory: string;
    filenamePrefix?: string;
    targetDate: string;
    uniqId: string;
  },
): Promise<{
  bytes: number;
  filePath: string;
  filename: string;
  suggestedFilename: string;
}> {
  const suggestedFilename = download.suggestedFilename();
  const safeSuggestedFilename = sanitizeFilename(
    suggestedFilename || "剧集数据统计.xlsx",
  );
  const preferredFilename = `${options.filenamePrefix ? `${sanitizeFilename(options.filenamePrefix)}_` : ""}${sanitizeFilename(options.accountName)}_${sanitizeFilename(
    options.uniqId,
  )}_${sanitizeFilename(options.targetDate)}_${safeSuggestedFilename}`;
  const preferredFilePath = path.join(options.downloadDirectory, preferredFilename);
  const filePath = await getAvailableDownloadFilePath(preferredFilePath);
  const filename = path.basename(filePath);

  await saveDownloadStream(download, filePath);
  const fileStats = await stat(filePath);

  return {
    bytes: fileStats.size,
    filename,
    filePath,
    suggestedFilename,
  };
}

async function getAvailableDownloadFilePath(preferredFilePath: string): Promise<string> {
  const parsedPath = path.parse(preferredFilePath);

  for (let index = 0; index < 10_000; index += 1) {
    const candidatePath =
      index === 0
        ? preferredFilePath
        : path.join(parsedPath.dir, `${parsedPath.name} (${index})${parsedPath.ext}`);

    try {
      await stat(candidatePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return candidatePath;
      }
      throw error;
    }
  }

  throw new Error(`无法为下载文件生成可用名称：${preferredFilePath}`);
}

async function saveDownloadStream(download: Download, filePath: string): Promise<void> {
  const temporaryFilePath = `${filePath}.${process.pid}.${Date.now()}.partial`;

  try {
    const downloadStream = await download.createReadStream();
    await pipeline(downloadStream, createWriteStream(temporaryFilePath, { flags: "wx" }));
    await rename(temporaryFilePath, filePath);
  } catch (error) {
    await unlink(temporaryFilePath).catch(() => undefined);
    throw error;
  }
}

async function importDownloadedFile(
  savedFile: {
    filePath: string;
    filename: string;
  },
  options: {
    sourceName: string;
  },
) {
  const client = getDarenCenterClient();
  syncLogger.info("Resolving Daren Center source id", {
    sourceName: options.sourceName,
  });
  const sourceId = await client.getSourceId(options.sourceName);
  syncLogger.info("Resolved Daren Center source id", {
    sourceId,
    sourceName: options.sourceName,
  });
  const fileBuffer = await readFile(savedFile.filePath);
  syncLogger.info("Read downloaded file for import", {
    bytes: fileBuffer.byteLength,
    filePath: savedFile.filePath,
  });

  const result = await client.importCopyrightData({
    file: new Blob([new Uint8Array(fileBuffer)], {
      type: contentTypeForFile(savedFile.filename),
    }),
    filename: savedFile.filename,
    sourceId,
  });

  return {
    result,
    sourceId,
  };
}

async function importPromoteStatisticFile(
  savedFile: {
    filePath: string;
    filename: string;
  },
  options: {
    accountName: string;
    uniqId: string;
  },
) {
  const fileBuffer = await readFile(savedFile.filePath);
  syncLogger.info("Importing Weixin Channels promote file into Daren Center", {
    accountName: options.accountName,
    bytes: fileBuffer.byteLength,
    filePath: savedFile.filePath,
    filename: savedFile.filename,
    uniqId: options.uniqId,
  });

  const result = await getDarenCenterClient().importDramaHeatingActions({
    file: new Blob([new Uint8Array(fileBuffer)], {
      type: contentTypeForFile(savedFile.filename),
    }),
    filename: savedFile.filename,
  });

  syncLogger.info("Weixin Channels promote import completed", {
    accountName: options.accountName,
    body: result.body,
    filePath: savedFile.filePath,
    status: result.status,
    statusText: result.statusText,
    uniqId: options.uniqId,
  });

  return result;
}

async function clearLoginState(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page
    .evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    })
    .catch(() => undefined);
}

function sanitizeFilename(value: string): string {
  const withoutControlCharacters = Array.from(value, (character) =>
    character.charCodeAt(0) <= 31 ? "_" : character,
  ).join("");
  const sanitized = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);

  return sanitized || "unknown";
}

function contentTypeForFile(filename: string): string {
  const extension = path.extname(filename).toLowerCase();

  if (extension === ".csv") {
    return "text/csv";
  }

  if (extension === ".xls") {
    return "application/vnd.ms-excel";
  }

  return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Operation aborted"));
      return;
    }

    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new Error("Operation aborted"));
      },
      { once: true },
    );
  });
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new Error("Operation aborted"));
      return;
    }

    signal.addEventListener(
      "abort",
      () => {
        reject(new Error("Operation aborted"));
      },
      { once: true },
    );
  });
}
