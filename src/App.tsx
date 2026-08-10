import { useEffect, useState } from "react";
import type {
  MeituanSyncEvent,
  WeixinChannelsCustomDateRange,
  WeixinChannelsDatePreset,
  WeixinChannelsSettings,
  WeixinChannelsSyncEvent,
  WeixinChannelsSyncMode,
} from "../electron/shared";
import { InfoCircleOutlined } from "@ant-design/icons";
import {
  Alert,
  Badge,
  Button,
  ConfigProvider,
  DatePicker,
  Drawer,
  Input,
  Radio,
  Table,
  Tooltip,
} from "antd";
import type { TableColumnsType } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

import { cn } from "@/lib/utils";

dayjs.locale("zh-cn");

type PlatformStatus = "normal" | "needs-login";
type ImportStatus = "success" | "partial" | "failed" | "pending";

type Platform = {
  automationId: string;
  id: string;
  name: string;
  logo?: string;
  accountCount: number;
  status: PlatformStatus;
};

type ImportRecord = {
  platform: string;
  platformLogo?: string;
  account: string;
  taskName: string;
  taskType: string;
  total: number | string;
  success: number | string;
  failed: number | string;
  detail?: string;
  status: ImportStatus;
  startedAt: string;
  sourceId?: number;
  uniqId?: string;
};

const platformLogoUrl = (fileName: string): string =>
  `${import.meta.env.BASE_URL}platform/${fileName}`;

const normalizePlatformLogoUrl = (logo: string): string =>
  logo.startsWith("/platform/")
    ? `${import.meta.env.BASE_URL}${logo.slice(1)}`
    : logo;

const platforms: Platform[] = [
  { automationId: "weixin-channels", id: "wx", name: "微信视频号", logo: platformLogoUrl("wx.svg"), accountCount: 3, status: "normal" },
  {
    automationId: "kuaishou",
    id: "kuaishou",
    name: "快手",
    logo: platformLogoUrl("kuaishou.svg"),
    accountCount: 4,
    status: "normal",
  },
  { automationId: "pinduoduo", id: "pdd", name: "拼多多", logo: platformLogoUrl("pdd.svg"), accountCount: 2, status: "needs-login" },
  { automationId: "meituan", id: "meituan", name: "美团", logo: platformLogoUrl("meituan.svg"), accountCount: 0, status: "normal" },
  { automationId: "tencent-video", id: "tencent", name: "腾讯视频", accountCount: 3, status: "normal" },
  { automationId: "qq-short-drama", id: "qq", name: "QQ漫剧", logo: platformLogoUrl("qq.svg"), accountCount: 2, status: "normal" },
  { automationId: "tiktok-drama", id: "tiktok", name: "TikTok", logo: platformLogoUrl("tiktok.svg"), accountCount: 2, status: "normal" },
];

const importRecordsStorageKey = "drama-sync-center:import-records";
const defaultWeixinSettings: WeixinChannelsSettings = {
  assistantDatePreset: "previous-day",
  promoteDatePreset: "previous-day",
};

function App() {
  const [meituanSyncRunning, setMeituanSyncRunning] = useState(false);
  const [platformItems, setPlatformItems] = useState(platforms);
  const [weixinSyncRunning, setWeixinSyncRunning] = useState<Record<WeixinChannelsSyncMode, boolean>>({
    assistant: false,
    promote: false,
  });
  const [weixinSettings, setWeixinSettings] = useState(defaultWeixinSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [weixinSyncMessage, setWeixinSyncMessage] = useState("服务运行中");
  const [importRecords, setImportRecords] = useState<ImportRecord[]>(() => loadImportRecords());

  useEffect(() => {
    if (!window.desktop?.platforms) {
      return;
    }

    void window.desktop.platforms
      .list()
      .then((catalog) => {
        const accountCounts = new Map(
          catalog.map((item) => [item.id, item.accounts.length]),
        );
        setPlatformItems((items) =>
          items.map((item) => ({
            ...item,
            accountCount: accountCounts.get(item.automationId) ?? item.accountCount,
          })),
        );
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setWeixinSyncMessage(`平台账号配置读取失败：${message}`);
      });
  }, []);

  useEffect(() => {
    if (!window.desktop?.weixinChannels) {
      return undefined;
    }

    void window.desktop.weixinChannels.getSettings().then(setWeixinSettings);

    return window.desktop.weixinChannels.onSyncEvent((event) => {
      setWeixinSyncMessage(event.message);

      if (event.type === "started" || event.type === "waiting-for-scan") {
        if (event.mode) {
          setWeixinSyncRunning((running) => ({ ...running, [event.mode!]: true }));
        }
      }

      if (event.type === "stopped" || event.type === "error") {
        if (event.mode) {
          setWeixinSyncRunning((running) => ({ ...running, [event.mode!]: false }));
        }
      }

      if (event.type === "imported" || event.type === "account-failed") {
        setImportRecords((records) => {
          const nextRecords = [createImportRecordFromEvent(event), ...records].slice(0, 50);
          saveImportRecords(nextRecords);
          return nextRecords;
        });
      }
    });
  }, []);

  useEffect(() => {
    if (!window.desktop?.meituan) {
      return undefined;
    }

    return window.desktop.meituan.onSyncEvent((event) => {
      setWeixinSyncMessage(event.message);

      if (event.type === "started" || event.type === "waiting-for-login") {
        setMeituanSyncRunning(true);
      }

      if (event.type === "stopped" || event.type === "error") {
        setMeituanSyncRunning(false);
      }

      if (event.type === "imported" || event.type === "account-failed") {
        setImportRecords((records) => {
          const nextRecords = [createMeituanImportRecord(event), ...records].slice(0, 50);
          saveImportRecords(nextRecords);
          return nextRecords;
        });
      }
    });
  }, []);

  async function startWeixinSync(mode: WeixinChannelsSyncMode) {
    if (!window.desktop?.weixinChannels) {
      setWeixinSyncMessage("当前环境不支持桌面自动化");
      return;
    }

    setWeixinSyncRunning((running) => ({ ...running, [mode]: true }));
    setWeixinSyncMessage(
      mode === "promote" ? "正在启动微信视频号加热平台处理任务" : "正在启动微信视频号助手处理任务",
    );
    const result = await window.desktop.weixinChannels.startSync(mode);

    if (!result.started && result.running) {
      setWeixinSyncMessage("微信视频号同步任务正在运行");
    }
  }

  async function saveWeixinSettings(settings: WeixinChannelsSettings) {
    if (!window.desktop?.weixinChannels) {
      return;
    }
    const saved = await window.desktop.weixinChannels.saveSettings(settings);
    setWeixinSettings(saved);
    setSettingsOpen(false);
    setWeixinSyncMessage("微信视频号配置已保存");
  }

  async function openWeixinDownloadDirectory() {
    if (!window.desktop?.weixinChannels) {
      setWeixinSyncMessage("打开文件夹失败：桌面功能未加载，请重启应用");
      return;
    }
    try {
      const result = await window.desktop.weixinChannels.openDownloadDirectory();
      setWeixinSyncMessage(result.error ? `打开文件夹失败：${result.error}` : `已打开：${result.path}`);
    } catch (error) {
      setWeixinSyncMessage(`打开文件夹失败：${getErrorMessage(error)}`);
    }
  }

  async function startMeituanSync() {
    if (!window.desktop?.meituan) {
      setWeixinSyncMessage("当前环境不支持桌面自动化");
      return;
    }

    setMeituanSyncRunning(true);
    setWeixinSyncMessage("正在启动美团合集数据处理任务");
    const result = await window.desktop.meituan.startSync();

    if (!result.started && result.running) {
      setWeixinSyncMessage("美团合集数据处理任务正在运行");
    }
  }

  async function openMeituanDownloadDirectory() {
    if (!window.desktop?.meituan) {
      return;
    }

    const result = await window.desktop.meituan.openDownloadDirectory();
    setWeixinSyncMessage(result.error ? `打开文件夹失败：${result.error}` : `已打开：${result.path}`);
  }

  return (
    <ConfigProvider
      locale={zhCN}
      componentSize="small"
      theme={{
        token: {
          borderRadius: 6,
          colorPrimary: "#2563eb",
          fontFamily: '"Geist Variable", "Microsoft YaHei", system-ui, sans-serif',
        },
      }}
    >
      <main className="min-h-screen overflow-x-hidden bg-[#eef2f7] text-slate-900">
      <div className="flex min-h-screen flex-col border-x border-slate-300/70 bg-[#f6f8fb]">
        <section className="grid grid-cols-[repeat(auto-fit,minmax(176px,1fr))] gap-2.5 border-b border-slate-200 bg-[#f3f6fa] px-3 py-3 lg:grid-cols-6">
          {platformItems.map((platform) => (
            <PlatformCard
              key={platform.id}
              platform={platform}
              assistantSyncing={platform.id === "wx" && weixinSyncRunning.assistant}
              promoteSyncing={platform.id === "wx" && weixinSyncRunning.promote}
              syncing={platform.id === "meituan" && meituanSyncRunning}
              onConfigure={platform.id === "wx" ? () => setSettingsOpen(true) : undefined}
              onOpenDirectory={
                platform.id === "wx"
                  ? openWeixinDownloadDirectory
                  : platform.id === "meituan"
                    ? openMeituanDownloadDirectory
                    : undefined
              }
              onAssistantSync={
                platform.id === "wx"
                  ? () => startWeixinSync("assistant")
                  : platform.id === "meituan"
                    ? startMeituanSync
                    : undefined
              }
              onPromoteSync={platform.id === "wx" ? () => startWeixinSync("promote") : undefined}
            />
          ))}
        </section>

        <section className="px-3 py-3">
          <div className="flex h-9 items-center justify-between px-1">
            <h2 className="text-[15px] font-semibold text-slate-950">最近处理记录</h2>
            <span className="text-xs text-slate-500">共 {importRecords.length} 条记录</span>
          </div>
          <ImportTable records={importRecords} />
        </section>

        <Footer statusText={weixinSyncMessage} />
        <WeixinSettingsDrawer
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onSave={saveWeixinSettings}
          settings={weixinSettings}
        />
      </div>
      </main>
    </ConfigProvider>
  );
}

function PlatformCard({
  assistantSyncing = false,
  onConfigure,
  onAssistantSync,
  onOpenDirectory,
  onPromoteSync,
  platform,
  promoteSyncing = false,
  syncing = false,
}: {
  assistantSyncing?: boolean
  onConfigure?: () => void
  onAssistantSync?: () => void
  onOpenDirectory?: () => void
  onPromoteSync?: () => void
  platform: Platform
  promoteSyncing?: boolean
  syncing?: boolean
}) {
  const needsLogin = platform.status === "needs-login";
  const actionLabel = needsLogin ? "修复登录" : "开始同步";

  if (platform.id === "wx") {
    return (
      <WeixinChannelsCard
        assistantSyncing={assistantSyncing}
        onConfigure={onConfigure}
        onAssistantSync={onAssistantSync}
        onOpenDirectory={onOpenDirectory}
        onPromoteSync={onPromoteSync}
        platform={platform}
        promoteSyncing={promoteSyncing}
      />
    );
  }

  return (
    <article className="min-w-0 rounded-lg border border-slate-300/80 bg-white overflow-hidden shadow-[0_1px_1px_rgba(15,23,42,0.025)]">
      <div className="flex min-h-[72px] items-start gap-3 px-3 py-3">
        <PlatformLogo platform={platform} />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="truncate text-[15px] font-semibold text-slate-950">{platform.name}</div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm text-slate-500">
            <span>{platform.accountCount} 个账号</span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap",
                needsLogin ? "text-amber-600" : "text-slate-500",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  needsLogin ? "bg-amber-500" : "bg-emerald-600",
                )}
              />
              {needsLogin ? "需验证" : "正常"}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/70 px-2.5 py-2">
        {onOpenDirectory ? (
          <Button
            onClick={onOpenDirectory}
            className="px-0 text-xs"
            type="link"
          >
            打开文件夹
          </Button>
        ) : null}
        <Button
          danger={needsLogin}
          disabled={syncing}
          loading={syncing}
          onClick={onAssistantSync}
          size="small"
        >
          {syncing ? "数据处理中" : actionLabel}
        </Button>
      </div>
    </article>
  );
}

function WeixinChannelsCard({
  assistantSyncing,
  onConfigure,
  onAssistantSync,
  onOpenDirectory,
  onPromoteSync,
  platform,
  promoteSyncing,
}: {
  assistantSyncing: boolean
  onConfigure?: () => void
  onAssistantSync?: () => void
  onOpenDirectory?: () => void
  onPromoteSync?: () => void
  platform: Platform
  promoteSyncing: boolean
}) {
  return (
    <article className="col-span-full min-w-0 overflow-hidden rounded-lg border border-slate-300/80 bg-white shadow-[0_1px_1px_rgba(15,23,42,0.025)] lg:flex lg:items-stretch lg:justify-between">
      <div className="flex min-h-[72px] items-start gap-3 px-3 py-3 lg:min-w-[300px] lg:items-center lg:pr-6">
        <PlatformLogo platform={platform} />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center gap-3">
            <div className="truncate text-[15px] font-semibold text-slate-950">{platform.name}</div>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-sm text-slate-500">
              <span className="size-1.5 rounded-full bg-emerald-600" />
              正常
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs text-slate-600">
            <span>需手动逐个登录</span>
            <ProcessTooltip />
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-xs">
            <Button type="link" size="small" onClick={onConfigure} className="h-auto px-0 text-xs">
              配置
            </Button>
            <Button type="link" size="small" onClick={onOpenDirectory} className="h-auto px-0 text-xs text-slate-600">
              打开文件夹
            </Button>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50/70 p-2.5 sm:flex-row lg:min-w-[500px] lg:items-center lg:border-l lg:border-t-0 lg:px-3">
        <Button
          disabled={assistantSyncing}
          loading={assistantSyncing}
          onClick={onAssistantSync}
          size="small"
          type="primary"
          className="h-8 flex-1 text-xs"
          title="微信视频号-助手剧集数据处理"
        >
          {assistantSyncing ? "助手剧集数据处理中" : "助手 · 剧集数据处理"}
        </Button>
        <Button
          disabled={promoteSyncing}
          loading={promoteSyncing}
          onClick={onPromoteSync}
          size="small"
          className="h-8 flex-1 text-xs"
          title="微信视频号-加热平台数据明细处理"
        >
          {promoteSyncing ? "加热平台数据处理中" : "加热平台 · 数据明细处理"}
        </Button>
      </div>
    </article>
  );
}

function ProcessTooltip() {
  return (
    <Tooltip
      placement="bottomLeft"
      title="默认下载前一天的数据。开始后请按提示手动登录，系统会在每个账号登录后自动完成下载和导入，再继续处理下一个账号。"
    >
      <Button
        aria-label="查看微信视频号数据处理说明"
        className="text-slate-500"
        icon={<InfoCircleOutlined />}
        shape="circle"
        type="text"
      />
    </Tooltip>
  );
}

const datePresetOptions: Array<{
  description: string
  label: string
  value: WeixinChannelsDatePreset
}> = [
  { value: "previous-day", label: "前一天", description: "默认，处理昨天的数据" },
  { value: "today", label: "当天", description: "处理今天截至当前的数据" },
  { value: "last-7-days", label: "最近 7 天", description: "包含今天，共 7 个自然日" },
  { value: "month-to-date", label: "本月截至今天", description: "从本月 1 日到今天" },
  { value: "previous-month", label: "上月整月", description: "上月 1 日到上月最后一天" },
  { value: "custom", label: "自定义日期", description: "指定开始日期和结束日期" },
];

function WeixinSettingsDrawer({
  onOpenChange,
  onSave,
  open,
  settings,
}: {
  onOpenChange: (open: boolean) => void
  onSave: (settings: WeixinChannelsSettings) => Promise<void>
  open: boolean
  settings: WeixinChannelsSettings
}) {
  const [draft, setDraft] = useState(settings);
  const [configurationError, setConfigurationError] = useState<string>();
  const [directoryError, setDirectoryError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setConfigurationError(undefined);
      setDirectoryError(undefined);
    }
  }, [open, settings]);

  async function chooseDirectory() {
    if (!window.desktop?.weixinChannels) {
      setDirectoryError("桌面功能未加载，请重启应用后重试");
      return;
    }

    setDirectoryError(undefined);
    try {
      const directory = await window.desktop.weixinChannels.chooseDownloadDirectory();
      if (directory) {
        setDraft((current) => ({ ...current, downloadDirectory: directory }));
      }
    } catch (error) {
      window.desktop.log.error("选择微信视频号文件保存位置失败", {
        error: getErrorMessage(error),
      });
      setDirectoryError(`无法选择文件夹：${getErrorMessage(error)}`);
    }
  }

  async function save() {
    const validationError = validateWeixinSettings(draft);
    if (validationError) {
      setConfigurationError(validationError);
      return;
    }

    setConfigurationError(undefined);
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      destroyOnHidden
      height="88vh"
      open={open}
      placement="bottom"
      title={
        <div>
          <div className="text-base font-semibold">微信视频号处理配置</div>
          <div className="mt-0.5 text-xs font-normal text-slate-500">
            日期范围在每次任务启动时读取；留空下载位置则使用应用默认目录。
          </div>
        </div>
      }
      onClose={() => onOpenChange(false)}
      styles={{ body: { padding: 0 } }}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button loading={saving} onClick={save} type="primary">
            保存配置
          </Button>
        </div>
      }
    >
      <div className="grid gap-6 px-5 py-5 lg:grid-cols-2">
        <DatePresetFieldset
          customRange={draft.assistantCustomDateRange}
          label="助手 · 剧集数据"
          name="assistant-date-preset"
          onChange={(assistantDatePreset) => {
            setConfigurationError(undefined);
            setDraft((current) => ({
              ...current,
              assistantCustomDateRange:
                assistantDatePreset === "custom"
                  ? current.assistantCustomDateRange ?? createDefaultCustomDateRange()
                  : current.assistantCustomDateRange,
              assistantDatePreset,
            }));
          }}
          onCustomRangeChange={(assistantCustomDateRange) => {
            setConfigurationError(undefined);
            setDraft((current) => ({ ...current, assistantCustomDateRange }));
          }}
          value={draft.assistantDatePreset}
        />
        <DatePresetFieldset
          customRange={draft.promoteCustomDateRange}
          label="加热平台 · 数据明细"
          name="promote-date-preset"
          onChange={(promoteDatePreset) => {
            setConfigurationError(undefined);
            setDraft((current) => ({
              ...current,
              promoteCustomDateRange:
                promoteDatePreset === "custom"
                  ? current.promoteCustomDateRange ?? createDefaultCustomDateRange()
                  : current.promoteCustomDateRange,
              promoteDatePreset,
            }));
          }}
          onCustomRangeChange={(promoteCustomDateRange) => {
            setConfigurationError(undefined);
            setDraft((current) => ({ ...current, promoteCustomDateRange }));
          }}
          value={draft.promoteDatePreset}
        />
      </div>

      {configurationError ? (
        <Alert className="mx-5 mb-5" message={configurationError} showIcon type="error" />
      ) : null}

      <div className="border-t border-slate-200 px-5 py-4">
        <label className="text-sm font-medium text-slate-900">文件保存位置</label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input
            readOnly
            value={draft.downloadDirectory ?? ""}
            placeholder="未设置，使用应用默认目录"
            className="min-w-0 flex-1"
          />
          <Button onClick={chooseDirectory}>选择文件夹</Button>
          {draft.downloadDirectory ? (
            <Button
              type="text"
              onClick={() => setDraft((current) => ({ ...current, downloadDirectory: undefined }))}
            >
              恢复默认
            </Button>
          ) : null}
        </div>
        {directoryError ? (
          <Alert className="mt-2" message={directoryError} showIcon type="error" />
        ) : null}
      </div>
    </Drawer>
  );
}

function DatePresetFieldset({
  customRange,
  label,
  name,
  onChange,
  onCustomRangeChange,
  value,
}: {
  customRange?: WeixinChannelsCustomDateRange
  label: string
  name: string
  onChange: (value: WeixinChannelsDatePreset) => void
  onCustomRangeChange: (value: WeixinChannelsCustomDateRange) => void
  value: WeixinChannelsDatePreset
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-slate-950">{label}</legend>
      <Radio.Group
        className="mt-2 block divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200"
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value as WeixinChannelsDatePreset)}
      >
        {datePresetOptions.map((option) => (
          <div key={option.value}>
            <Radio className="flex w-full items-start px-3 py-2.5 hover:bg-slate-50" value={option.value}>
              <span className="ml-1 inline-block">
                <span className="block text-sm font-medium text-slate-800">{option.label}</span>
                <span className="block text-xs text-slate-500">{option.description}</span>
              </span>
            </Radio>
            {option.value === "custom" && value === "custom" && customRange ? (
              <div className="border-t border-slate-100 bg-slate-50/70 px-3 py-3">
                <DatePicker.RangePicker
                  allowClear={false}
                  format="YYYY-MM-DD"
                  maxDate={dayjs()}
                  value={[
                    dayjs(customRange.startDate),
                    dayjs(customRange.endDate),
                  ]}
                  className="w-full"
                  onChange={(dates) => {
                    if (!dates?.[0] || !dates[1]) {
                      return;
                    }
                    onCustomRangeChange({
                      endDate: dates[1].format("YYYY-MM-DD"),
                      startDate: dates[0].format("YYYY-MM-DD"),
                    });
                  }}
                />
              </div>
            ) : null}
          </div>
        ))}
      </Radio.Group>
    </fieldset>
  );
}

function PlatformLogo({ platform }: { platform: Platform }) {
  if (platform.logo) {
    return <img src={platform.logo} alt="" className="size-9 shrink-0 rounded-md object-contain" />;
  }

  return (
    <span className="relative flex size-9 shrink-0 items-center justify-center rounded-md bg-white">
      <span className="absolute inset-1 rounded-[10px] bg-gradient-to-br from-emerald-400 via-cyan-400 to-blue-500" />
      <span className="relative ml-0.5 h-0 w-0 border-y-[10px] border-l-[15px] border-y-transparent border-l-white" />
    </span>
  );
}

function ImportTable({ records }: { records: ImportRecord[] }) {
  const columns: TableColumnsType<ImportRecord> = [
    {
      dataIndex: "platform",
      title: "来源平台",
      width: 120,
      render: (platform: string, record) => (
        <span className="flex items-center gap-2">
          <SmallPlatformLogo logo={record.platformLogo} name={platform} />
          {platform}
        </span>
      ),
    },
    {
      dataIndex: "taskName",
      ellipsis: true,
      title: "任务标识",
      width: 160,
      render: (taskName: string, record) => (
        <div className="min-w-0">
          <span className="block truncate" title={record.detail ?? record.taskType}>{taskName}</span>
          {record.detail ? (
            <span className="block truncate text-[11px] text-red-600" title={record.detail}>
              {record.detail}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      dataIndex: "account",
      ellipsis: true,
      title: "账号",
      width: 145,
      render: (account: string, record) => (
        <div className="min-w-0">
          <span className="block truncate">{account}</span>
          {record.uniqId ? (
            <span className="block truncate font-mono text-[11px] text-slate-500" title={record.uniqId}>
              {record.uniqId}
            </span>
          ) : null}
        </div>
      ),
    },
    { align: "center", dataIndex: "total", title: "总条数", width: 80 },
    {
      align: "center",
      dataIndex: "success",
      title: "成功",
      width: 72,
      render: (value: ImportRecord["success"]) => <span className="font-medium text-emerald-600">{value}</span>,
    },
    {
      align: "center",
      dataIndex: "failed",
      title: "失败",
      width: 72,
      render: (value: ImportRecord["failed"]) => <span className="font-medium text-red-600">{value}</span>,
    },
    {
      dataIndex: "status",
      title: "状态",
      width: 100,
      render: (status: ImportStatus) => <StatusBadge status={status} />,
    },
    { dataIndex: "startedAt", title: "开始时间", width: 145 },
  ];

  return (
    <Table
      bordered
      columns={columns}
      dataSource={records}
      locale={{ emptyText: "暂无导入记录" }}
      pagination={false}
      rowKey={(record) => `${record.platform}-${record.account}-${record.startedAt}`}
      scroll={{ x: 996 }}
      size="small"
    />
  );
}

function SmallPlatformLogo({ logo, name }: { logo?: string; name: string }) {
  if (logo) {
    return <img src={logo} alt="" className="size-5 shrink-0 object-contain" />;
  }

  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded bg-gradient-to-br from-emerald-400 via-cyan-400 to-blue-500">
      <span className="ml-0.5 h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-white" />
      <span className="sr-only">{name}</span>
    </span>
  );
}

function StatusBadge({ status }: { status: ImportStatus }) {
  const statusMap = {
    success: { label: "成功", badgeStatus: "success" },
    partial: { label: "部分失败", badgeStatus: "warning" },
    failed: { label: "失败", badgeStatus: "error" },
    pending: { label: "待接入", badgeStatus: "default" },
  } satisfies Record<ImportStatus, {
    badgeStatus: "default" | "error" | "success" | "warning"
    label: string
  }>;

  const item = statusMap[status];

  return <Badge status={item.badgeStatus} text={item.label} />;
}

function Footer({ statusText }: { statusText: string }) {
  return (
    <footer className="mt-auto flex min-h-9 flex-wrap items-center justify-between gap-x-8 gap-y-2 border-t border-slate-300/80 bg-[#f8fafc] px-3 py-2 text-xs text-slate-500">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
        <span className="inline-flex items-center gap-2 text-slate-700">
          <span className="size-2 rounded-full bg-emerald-600" />
          {statusText}
        </span>
        <span>版本：v1.2.0</span>
      </div>
      <span>数据更新时间：2025-05-20 10:23:50</span>
    </footer>
  );
}

function createImportRecordFromEvent(event: WeixinChannelsSyncEvent): ImportRecord {
  if (event.type === "account-failed") {
    return {
      account: event.accountName ?? "微信视频号账号",
      detail: event.failureReason ?? event.message,
      failed: 1,
      platform: "微信视频号",
      platformLogo: platformLogoUrl("wx.svg"),
      startedAt: formatDateTime(event.timestamp ? new Date(event.timestamp) : new Date()),
      status: "failed",
      success: 0,
      taskName: "助手 · 剧集数据处理",
      taskType: event.taskType ?? "weixin-channels-playlet-statistic",
      total: "-",
      uniqId: event.uniqId,
    };
  }

  const counts = extractImportCounts(event.result);
  const failed = counts.failed ?? 0;
  const importPending = isRecord(event.result) && event.result.importPending === true;

  return {
    account: event.accountName ?? "微信视频号账号",
    detail: event.failureReason,
    failed: counts.failed ?? "-",
    platform: "微信视频号",
    platformLogo: platformLogoUrl("wx.svg"),
    sourceId: event.sourceId,
    startedAt: formatDateTime(event.timestamp ? new Date(event.timestamp) : new Date()),
    status: importPending ? "pending" : failed > 0 ? "partial" : "success",
    success: counts.success ?? "-",
    taskName: event.taskName ?? "助手 · 剧集数据处理",
    taskType: event.taskType ?? "weixin-channels-playlet-statistic",
    total: counts.total ?? "-",
    uniqId: event.uniqId,
  };
}

function createMeituanImportRecord(event: MeituanSyncEvent): ImportRecord {
  if (event.type === "account-failed") {
    return {
      account: event.accountName ?? "美团账号",
      detail: event.failureReason ?? event.message,
      failed: 1,
      platform: "美团",
      platformLogo: platformLogoUrl("meituan.svg"),
      startedAt: formatDateTime(event.timestamp ? new Date(event.timestamp) : new Date()),
      status: "failed",
      success: 0,
      taskName: event.taskName ?? "合集数据处理",
      taskType: event.taskType ?? "meituan-video-set-list",
      total: event.total ?? "-",
      uniqId: event.uniqId,
    };
  }

  const counts = extractImportCounts(event.result);
  const importPending = isRecord(event.result) && event.result.importPending === true;

  return {
    account: event.accountName ?? "美团账号",
    failed: counts.failed ?? 0,
    platform: "美团",
    platformLogo: platformLogoUrl("meituan.svg"),
    startedAt: formatDateTime(event.timestamp ? new Date(event.timestamp) : new Date()),
    status: importPending ? "pending" : "success",
    success: counts.success ?? 0,
    taskName: event.taskName ?? "合集数据处理",
    taskType: event.taskType ?? "meituan-video-set-list",
    total: counts.total ?? event.total ?? "-",
    uniqId: event.uniqId,
  };
}

function extractImportCounts(result: unknown): {
  failed?: number
  success?: number
  total?: number
} {
  const data = isRecord(result) && isRecord(result.data) ? result.data : result;

  return {
    failed: findNumericValue(data, ["failed", "fail", "failCount", "failureCount", "errorCount"]),
    success: findNumericValue(data, ["success", "successCount", "imported", "importedCount"]),
    total: findNumericValue(data, ["total", "totalCount", "count", "rowCount"]),
  };
}

function findNumericValue(value: unknown, keys: string[]): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of keys) {
    const directValue = value[key];
    if (typeof directValue === "number" && Number.isFinite(directValue)) {
      return directValue;
    }
  }

  for (const child of Object.values(value)) {
    const nestedValue = findNumericValue(child, keys);
    if (nestedValue !== undefined) {
      return nestedValue;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createDefaultCustomDateRange(): WeixinChannelsCustomDateRange {
  const previousDay = new Date();
  previousDay.setDate(previousDay.getDate() - 1);
  const date = formatDateInputValue(previousDay);
  return { endDate: date, startDate: date };
}

function validateWeixinSettings(settings: WeixinChannelsSettings): string | undefined {
  const selections: Array<{
    label: string
    preset: WeixinChannelsDatePreset
    range?: WeixinChannelsCustomDateRange
  }> = [
    {
      label: "助手 · 剧集数据",
      preset: settings.assistantDatePreset,
      range: settings.assistantCustomDateRange,
    },
    {
      label: "加热平台 · 数据明细",
      preset: settings.promoteDatePreset,
      range: settings.promoteCustomDateRange,
    },
  ];
  const today = formatDateInputValue(new Date());

  for (const selection of selections) {
    if (selection.preset !== "custom") {
      continue;
    }
    if (!selection.range?.startDate || !selection.range.endDate) {
      return `${selection.label}：请选择完整的开始日期和结束日期`;
    }
    if (selection.range.endDate < selection.range.startDate) {
      return `${selection.label}：结束日期不能早于开始日期`;
    }
    if (selection.range.endDate > today) {
      return `${selection.label}：结束日期不能晚于今天`;
    }
  }

  return undefined;
}

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function loadImportRecords(): ImportRecord[] {
  try {
    const rawRecords = localStorage.getItem(importRecordsStorageKey);
    if (!rawRecords) {
      return [];
    }

    const records = JSON.parse(rawRecords);
    return Array.isArray(records)
      ? records.map(normalizeImportRecord).slice(0, 50)
      : [];
  } catch {
    return [];
  }
}

function saveImportRecords(records: ImportRecord[]): void {
  localStorage.setItem(importRecordsStorageKey, JSON.stringify(records));
}

function normalizeImportRecord(record: unknown): ImportRecord {
  const rawRecord = isRecord(record) ? record : {};

  return {
    account: typeof rawRecord.account === "string" ? rawRecord.account : "微信视频号账号",
    detail: typeof rawRecord.detail === "string" ? rawRecord.detail : undefined,
    failed: typeof rawRecord.failed === "number" || typeof rawRecord.failed === "string" ? rawRecord.failed : "-",
    platform: typeof rawRecord.platform === "string" ? rawRecord.platform : "微信视频号",
    platformLogo:
      typeof rawRecord.platformLogo === "string"
        ? normalizePlatformLogoUrl(rawRecord.platformLogo)
        : platformLogoUrl("wx.svg"),
    sourceId: typeof rawRecord.sourceId === "number" ? rawRecord.sourceId : undefined,
    startedAt: typeof rawRecord.startedAt === "string" ? rawRecord.startedAt : formatDateTime(new Date()),
    status:
      rawRecord.status === "partial" ||
      rawRecord.status === "failed" ||
      rawRecord.status === "pending" ||
      rawRecord.status === "success"
        ? rawRecord.status
        : "success",
    success: typeof rawRecord.success === "number" || typeof rawRecord.success === "string" ? rawRecord.success : "-",
    taskName: typeof rawRecord.taskName === "string" ? rawRecord.taskName : "助手 · 剧集数据处理",
    taskType:
      typeof rawRecord.taskType === "string"
        ? rawRecord.taskType
        : "weixin-channels-playlet-statistic",
    total: typeof rawRecord.total === "number" || typeof rawRecord.total === "string" ? rawRecord.total : "-",
    uniqId: typeof rawRecord.uniqId === "string" ? rawRecord.uniqId : undefined,
  };
}

export default App;
