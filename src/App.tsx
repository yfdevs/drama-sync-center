import { useEffect, useState } from "react";
import type {
  WeixinChannelsDatePreset,
  WeixinChannelsSettings,
  WeixinChannelsSyncEvent,
  WeixinChannelsSyncMode,
} from "../electron/shared";
import { Dialog } from "@base-ui/react/dialog";
import { Tooltip } from "@base-ui/react/tooltip";
import { InfoCircle } from "@mynaui/icons-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PlatformStatus = "normal" | "needs-login";
type ImportStatus = "success" | "partial" | "failed" | "pending";

type Platform = {
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
  { id: "wx", name: "微信视频号", logo: platformLogoUrl("wx.svg"), accountCount: 3, status: "normal" },
  {
    id: "kuaishou",
    name: "快手",
    logo: platformLogoUrl("kuaishou.svg"),
    accountCount: 4,
    status: "normal",
  },
  { id: "pdd", name: "拼多多", logo: platformLogoUrl("pdd.svg"), accountCount: 2, status: "needs-login" },
  { id: "meituan", name: "美团", logo: platformLogoUrl("meituan.svg"), accountCount: 2, status: "normal" },
  { id: "tencent", name: "腾讯视频", accountCount: 3, status: "normal" },
  { id: "qq", name: "QQ漫剧", logo: platformLogoUrl("qq.svg"), accountCount: 2, status: "normal" },
  { id: "tiktok", name: "TikTok", logo: platformLogoUrl("tiktok.svg"), accountCount: 2, status: "normal" },
];

const importRecordsStorageKey = "drama-sync-center:import-records";
const defaultWeixinSettings: WeixinChannelsSettings = {
  assistantDatePreset: "previous-day",
  promoteDatePreset: "previous-day",
};

function App() {
  const [weixinSyncRunning, setWeixinSyncRunning] = useState<Record<WeixinChannelsSyncMode, boolean>>({
    assistant: false,
    promote: false,
  });
  const [weixinSettings, setWeixinSettings] = useState(defaultWeixinSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [weixinSyncMessage, setWeixinSyncMessage] = useState("服务运行中");
  const [importRecords, setImportRecords] = useState<ImportRecord[]>(() => loadImportRecords());

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
      return;
    }
    const result = await window.desktop.weixinChannels.openDownloadDirectory();
    setWeixinSyncMessage(result.error ? `打开文件夹失败：${result.error}` : `已打开：${result.path}`);
  }

  return (
    <Tooltip.Provider delay={250}>
      <main className="min-h-screen overflow-x-hidden bg-[#eef2f7] text-slate-900">
      <div className="flex min-h-screen flex-col border-x border-slate-300/70 bg-[#f6f8fb]">
        <section className="grid grid-cols-[repeat(auto-fit,minmax(176px,1fr))] gap-2.5 border-b border-slate-200 bg-[#f3f6fa] px-3 py-3 lg:grid-cols-6">
          {platforms.map((platform) => (
            <PlatformCard
              key={platform.id}
              platform={platform}
              assistantSyncing={platform.id === "wx" && weixinSyncRunning.assistant}
              promoteSyncing={platform.id === "wx" && weixinSyncRunning.promote}
              onConfigure={platform.id === "wx" ? () => setSettingsOpen(true) : undefined}
              onOpenDirectory={platform.id === "wx" ? openWeixinDownloadDirectory : undefined}
              onAssistantSync={platform.id === "wx" ? () => startWeixinSync("assistant") : undefined}
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
    </Tooltip.Provider>
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
}: {
  assistantSyncing?: boolean
  onConfigure?: () => void
  onAssistantSync?: () => void
  onOpenDirectory?: () => void
  onPromoteSync?: () => void
  platform: Platform
  promoteSyncing?: boolean
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
      <div className="flex justify-end border-t border-slate-100 bg-slate-50/70 px-2.5 py-2">
        <Button
          onClick={onAssistantSync}
          variant="outline"
          size="xs"
          className={cn(
            "h-7 rounded-md bg-white px-2.5 text-xs font-medium shadow-none",
            needsLogin
              ? "border-amber-300 text-amber-700 hover:bg-amber-50"
              : "border-blue-200 text-blue-700 hover:border-blue-300 hover:bg-blue-50",
          )}
        >
          {actionLabel}
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
            <button type="button" onClick={onConfigure} className="text-blue-700 hover:underline">
              配置
            </button>
            <button type="button" onClick={onOpenDirectory} className="text-slate-600 hover:text-slate-950 hover:underline">
              打开文件夹
            </button>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50/70 p-2.5 sm:flex-row lg:min-w-[500px] lg:items-center lg:border-l lg:border-t-0 lg:px-3">
        <Button
          disabled={assistantSyncing}
          onClick={onAssistantSync}
          size="sm"
          className="h-8 flex-1 rounded-md bg-blue-600 px-3 text-xs font-medium text-white shadow-none hover:bg-blue-700"
          title="微信视频号-助手剧集数据处理"
        >
          {assistantSyncing ? "助手剧集数据处理中" : "助手 · 剧集数据处理"}
        </Button>
        <Button
          disabled={promoteSyncing}
          onClick={onPromoteSync}
          variant="outline"
          size="sm"
          className="h-8 flex-1 rounded-md border-blue-200 bg-white px-3 text-xs font-medium text-blue-700 shadow-none hover:border-blue-300 hover:bg-blue-50"
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
    <Tooltip.Root>
      <Tooltip.Trigger
        aria-label="查看微信视频号数据处理说明"
        className="inline-flex size-5 items-center justify-center rounded-md text-slate-500 outline-none transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-blue-500/60"
      >
        <InfoCircle aria-hidden="true" className="size-3.5" />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
          <Tooltip.Popup className="max-w-72 rounded-md bg-slate-950 px-3 py-2 text-xs leading-5 text-white shadow-[0_4px_8px_rgba(15,23,42,0.18)] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none">
            默认下载前一天的数据。开始后请按提示手动登录，系统会在每个账号登录后自动完成下载和导入，再继续处理下一个账号。
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(settings);
    }
  }, [open, settings]);

  async function chooseDirectory() {
    const directory = await window.desktop?.weixinChannels.chooseDownloadDirectory();
    if (directory) {
      setDraft((current) => ({ ...current, downloadDirectory: directory }));
    }
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-slate-950/35 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center">
          <Dialog.Popup className="max-h-[88vh] w-full overflow-y-auto rounded-t-xl bg-white shadow-[0_-4px_8px_rgba(15,23,42,0.12)] transition-transform duration-200 data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full motion-reduce:transition-none lg:max-w-5xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <Dialog.Title className="text-base font-semibold text-slate-950">微信视频号处理配置</Dialog.Title>
                <Dialog.Description className="mt-0.5 text-xs text-slate-500">
                  日期范围在每次任务启动时读取；留空下载位置则使用应用默认目录。
                </Dialog.Description>
              </div>
              <Dialog.Close className="h-8 rounded-md px-2.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-950">
                关闭
              </Dialog.Close>
            </div>

            <div className="grid gap-6 px-5 py-5 lg:grid-cols-2">
              <DatePresetFieldset
                label="助手 · 剧集数据"
                name="assistant-date-preset"
                onChange={(assistantDatePreset) =>
                  setDraft((current) => ({ ...current, assistantDatePreset }))
                }
                value={draft.assistantDatePreset}
              />
              <DatePresetFieldset
                label="加热平台 · 数据明细"
                name="promote-date-preset"
                onChange={(promoteDatePreset) =>
                  setDraft((current) => ({ ...current, promoteDatePreset }))
                }
                value={draft.promoteDatePreset}
              />
            </div>

            <div className="border-t border-slate-200 px-5 py-4">
              <label className="text-sm font-medium text-slate-900">文件保存位置</label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  readOnly
                  value={draft.downloadDirectory ?? ""}
                  placeholder="未设置，使用应用默认目录"
                  className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 text-sm text-slate-700 outline-none"
                />
                <Button type="button" variant="outline" onClick={chooseDirectory} className="h-9 px-3">
                  选择文件夹
                </Button>
                {draft.downloadDirectory ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setDraft((current) => ({ ...current, downloadDirectory: undefined }))}
                    className="h-9 px-3 text-slate-600"
                  >
                    恢复默认
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="h-8 px-3">
                取消
              </Button>
              <Button type="button" disabled={saving} onClick={save} className="h-8 bg-blue-600 px-4 text-white hover:bg-blue-700">
                {saving ? "保存中" : "保存配置"}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DatePresetFieldset({
  label,
  name,
  onChange,
  value,
}: {
  label: string
  name: string
  onChange: (value: WeixinChannelsDatePreset) => void
  value: WeixinChannelsDatePreset
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-slate-950">{label}</legend>
      <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {datePresetOptions.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-slate-50">
            <input
              type="radio"
              name={name}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="mt-1 size-4 accent-blue-600"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-800">{option.label}</span>
              <span className="block text-xs text-slate-500">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
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
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-300/80 bg-white">
      <table className="min-w-[680px] table-fixed border-collapse text-left text-[13px] lg:w-full">
        <thead className="bg-[#f1f4f8] text-slate-600">
          <tr className="h-9 border-b border-slate-300/80">
            <TableHead className="w-[15%]">来源平台</TableHead>
            <TableHead className="w-[18%]">任务标识</TableHead>
            <TableHead className="w-[17%]">账号</TableHead>
            <TableHead className="w-[10%] text-center">总条数</TableHead>
            <TableHead className="w-[9%] text-center">成功</TableHead>
            <TableHead className="w-[9%] text-center">失败</TableHead>
            <TableHead className="w-[10%]">状态</TableHead>
            <TableHead className="w-[12%]">开始时间</TableHead>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr
              key={`${record.platform}-${record.account}-${record.startedAt}`}
              className="h-11 border-b border-slate-100 last:border-b-0 hover:bg-blue-50/40"
            >
              <TableCell>
                <span className="flex items-center gap-2">
                  <SmallPlatformLogo logo={record.platformLogo} name={record.platform} />
                  {record.platform}
                </span>
              </TableCell>
              <TableCell>
                <span className="block truncate" title={record.detail ?? record.taskType}>
                  {record.taskName}
                </span>
                {record.detail ? (
                  <span className="block truncate text-[11px] text-red-600" title={record.detail}>
                    {record.detail}
                  </span>
                ) : null}
              </TableCell>
              <TableCell>
                <span className="block truncate">{record.account}</span>
                {record.uniqId ? (
                  <span className="block truncate font-mono text-[11px] text-slate-500" title={record.uniqId}>
                    {record.uniqId}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="text-center tabular-nums">{record.total}</TableCell>
              <TableCell className="text-center font-medium text-emerald-600 tabular-nums">
                {record.success}
              </TableCell>
              <TableCell className="text-center font-medium text-red-600 tabular-nums">
                {record.failed}
              </TableCell>
              <TableCell>
                <StatusBadge status={record.status} />
              </TableCell>
              <TableCell className="tabular-nums">{record.startedAt}</TableCell>
            </tr>
          ))}
        </tbody>
      </table>
      {records.length === 0 ? (
        <div className="flex h-24 items-center justify-center border-t border-slate-100 text-sm text-slate-500">
          暂无导入记录
        </div>
      ) : null}
    </div>
  );
}

function TableHead({ className, children }: { className?: string; children: React.ReactNode }) {
  return <th className={cn("px-2.5 font-medium", className)}>{children}</th>;
}

function TableCell({ className, children }: { className?: string; children: React.ReactNode }) {
  return <td className={cn("truncate px-2.5 text-slate-600", className)}>{children}</td>;
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
    success: { label: "成功", dot: "bg-emerald-600" },
    partial: { label: "部分失败", dot: "bg-amber-500" },
    failed: { label: "失败", dot: "bg-red-600" },
    pending: { label: "待接入", dot: "bg-slate-400" },
  } satisfies Record<ImportStatus, { label: string; dot: string }>;

  const item = statusMap[status];

  return (
    <span className="inline-flex items-center gap-2 text-slate-700">
      <span className={cn("size-2 rounded-full", item.dot)} />
      {item.label}
    </span>
  );
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
