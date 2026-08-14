import { useEffect, useState } from "react";
import type {
  KuaishouSettings,
  KuaishouSyncEvent,
  MeituanSyncEvent,
  UpdateSource,
  UpdateState,
  WeixinChannelsCustomDateRange,
  WeixinChannelsDatePreset,
  WeixinChannelsSettings,
  WeixinChannelsSyncEvent,
  WeixinChannelsSyncMode,
} from "../electron/shared";
import {
  DatabaseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SettingOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Badge,
  Button,
  ConfigProvider,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Popconfirm,
  Progress,
  Radio,
  Select,
  Table,
  Tooltip,
} from "antd";
import type { TableColumnsType } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

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
const defaultKuaishouSettings: KuaishouSettings = {
  datePreset: "previous-day",
};
const defaultUpdateState: UpdateState = {
  currentVersion: "1.0.0",
  message: "正在读取版本信息",
  phase: "idle",
  progress: 0,
  selectedSourceId: "github",
};

function App() {
  const [kuaishouSettings, setKuaishouSettings] = useState(defaultKuaishouSettings);
  const [kuaishouSettingsOpen, setKuaishouSettingsOpen] = useState(false);
  const [kuaishouSyncRunning, setKuaishouSyncRunning] = useState(false);
  const [meituanSyncRunning, setMeituanSyncRunning] = useState(false);
  const [platformItems, setPlatformItems] = useState(platforms);
  const [weixinSyncRunning, setWeixinSyncRunning] = useState<Record<WeixinChannelsSyncMode, boolean>>({
    assistant: false,
    promote: false,
  });
  const [weixinSettings, setWeixinSettings] = useState(defaultWeixinSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateDrawerOpen, setUpdateDrawerOpen] = useState(false);
  const [updateSources, setUpdateSources] = useState<UpdateSource[]>([]);
  const [updateState, setUpdateState] = useState<UpdateState>(defaultUpdateState);
  const [weixinSyncMessage, setWeixinSyncMessage] = useState("服务运行中");
  const [importRecords, setImportRecords] = useState<ImportRecord[]>(() => loadImportRecords());

  useEffect(() => {
    if (!window.desktop?.updater) {
      return undefined;
    }

    void Promise.all([
      window.desktop.updater.getState(),
      window.desktop.updater.getSources(),
    ]).then(([nextState, sources]) => {
      setUpdateState(nextState);
      setUpdateSources(sources);
    });

    return window.desktop.updater.onStatus(setUpdateState);
  }, []);

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
    if (!window.desktop?.kuaishou) {
      return undefined;
    }

    void window.desktop.kuaishou.getSettings().then(setKuaishouSettings);

    return window.desktop.kuaishou.onSyncEvent((event) => {
      setWeixinSyncMessage(event.message);

      if (event.type === "started" || event.type === "waiting-for-login") {
        setKuaishouSyncRunning(true);
      }
      if (event.type === "waiting-for-login") {
        setPlatformItems((items) => items.map((item) =>
          item.id === "kuaishou" ? { ...item, status: "needs-login" } : item
        ));
      }
      if (event.type === "logged-in" || event.type === "imported") {
        setPlatformItems((items) => items.map((item) =>
          item.id === "kuaishou" ? { ...item, status: "normal" } : item
        ));
      }
      if (event.type === "stopped" || event.type === "error") {
        setKuaishouSyncRunning(false);
      }
      if (event.type === "imported" || event.type === "account-failed") {
        setImportRecords((records) => {
          const nextRecords = [createKuaishouImportRecord(event), ...records].slice(0, 50);
          saveImportRecords(nextRecords);
          return nextRecords;
        });
      }
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

  async function startKuaishouSync() {
    if (!window.desktop?.kuaishou) {
      setWeixinSyncMessage("当前环境不支持桌面自动化");
      return;
    }

    setKuaishouSyncRunning(true);
    setWeixinSyncMessage("正在启动快手 IAA 短剧数据处理任务");
    const result = await window.desktop.kuaishou.startSync();
    if (!result.started && result.running) {
      setWeixinSyncMessage("快手数据处理任务正在运行");
    }
  }

  async function saveKuaishouSettings(settings: KuaishouSettings) {
    if (!window.desktop?.kuaishou) {
      return;
    }

    const saved = await window.desktop.kuaishou.saveSettings(settings);
    setKuaishouSettings(saved);
    setKuaishouSettingsOpen(false);
    setWeixinSyncMessage("快手处理配置已保存");
  }

  async function openKuaishouDownloadDirectory() {
    if (!window.desktop?.kuaishou) {
      return;
    }

    const result = await window.desktop.kuaishou.openDownloadDirectory();
    setWeixinSyncMessage(result.error ? `打开文件夹失败：${result.error}` : `已打开：${result.path}`);
  }

  async function openMeituanDownloadDirectory() {
    if (!window.desktop?.meituan) {
      return;
    }

    const result = await window.desktop.meituan.openDownloadDirectory();
    setWeixinSyncMessage(result.error ? `打开文件夹失败：${result.error}` : `已打开：${result.path}`);
  }

  function clearImportRecords() {
    localStorage.removeItem(importRecordsStorageKey);
    setImportRecords([]);
    setWeixinSyncMessage("已清空全部处理记录");
  }

  return (
    <ConfigProvider
      locale={zhCN}
      componentSize="small"
      theme={{
        token: {
          borderRadius: 8,
          colorBgContainer: "#ffffff",
          colorBorder: "#dfe3ea",
          colorPrimary: "#2455d6",
          colorText: "#172033",
          colorTextSecondary: "#667085",
          controlHeight: 36,
          fontFamily: '"Geist Variable", "Microsoft YaHei", system-ui, sans-serif',
        },
      }}
    >
      <main className="app-shell">
        <div className="app-content">
          <section aria-labelledby="platform-section-title">
            <div className="section-heading">
              <h2 id="platform-section-title">平台同步</h2>
              <span className="section-note">选择平台启动处理任务</span>
            </div>
            <div className="platform-grid">
              {platformItems.map((platform) => (
                <PlatformCard
                  key={platform.id}
                  platform={platform}
                  assistantSyncing={platform.id === "wx" && weixinSyncRunning.assistant}
                  promoteSyncing={platform.id === "wx" && weixinSyncRunning.promote}
                  syncing={
                    (platform.id === "meituan" && meituanSyncRunning) ||
                    (platform.id === "kuaishou" && kuaishouSyncRunning)
                  }
                  onConfigure={
                    platform.id === "wx"
                      ? () => setSettingsOpen(true)
                      : platform.id === "kuaishou"
                        ? () => setKuaishouSettingsOpen(true)
                        : undefined
                  }
                  onOpenDirectory={
                    platform.id === "wx"
                      ? openWeixinDownloadDirectory
                      : platform.id === "kuaishou"
                        ? openKuaishouDownloadDirectory
                      : platform.id === "meituan"
                        ? openMeituanDownloadDirectory
                        : undefined
                  }
                  onAssistantSync={
                    platform.id === "wx"
                      ? () => startWeixinSync("assistant")
                      : platform.id === "kuaishou"
                        ? startKuaishouSync
                      : platform.id === "meituan"
                        ? startMeituanSync
                        : undefined
                  }
                  onPromoteSync={platform.id === "wx" ? () => startWeixinSync("promote") : undefined}
                />
              ))}
            </div>
          </section>

          <section className="records-section" aria-labelledby="records-section-title">
            <div className="section-heading section-heading--records">
              <h2 id="records-section-title">最近处理记录</h2>
              <div className="records-actions">
                <span className="record-count">{importRecords.length} 条记录</span>
                <Popconfirm
                  cancelText="取消"
                  description="此操作只清理本机保存的处理记录，不影响平台账号和同步配置。"
                  okButtonProps={{ danger: true }}
                  okText="确认清空"
                  onConfirm={clearImportRecords}
                  title="清空全部处理记录？"
                >
                  <Button danger disabled={importRecords.length === 0} icon={<DeleteOutlined />} type="text">
                    清空记录
                  </Button>
                </Popconfirm>
              </div>
            </div>
            <div className="records-table">
              <ImportTable records={importRecords} />
            </div>
          </section>
        </div>

        <Footer
          onOpenUpdater={() => setUpdateDrawerOpen(true)}
          statusText={weixinSyncMessage}
          updateState={updateState}
        />
        <UpdateDrawer
          open={updateDrawerOpen}
          sources={updateSources}
          state={updateState}
          onOpenChange={setUpdateDrawerOpen}
          onStateChange={setUpdateState}
        />
        <WeixinSettingsDrawer
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onSave={saveWeixinSettings}
          settings={weixinSettings}
        />
        <KuaishouSettingsDrawer
          open={kuaishouSettingsOpen}
          onOpenChange={setKuaishouSettingsOpen}
          onSave={saveKuaishouSettings}
          settings={kuaishouSettings}
        />
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
  const canStart = Boolean(onAssistantSync);
  const actionLabel = needsLogin ? "修复登录" : canStart ? "开始处理" : "暂未接入";

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
    <article className="platform-card">
      <div className="platform-card__body">
        <PlatformLogo platform={platform} />
        <div className="platform-card__content">
          <div className="platform-card__title-row">
            <h3>{platform.name}</h3>
            {needsLogin ? <span className="status-label status-label--warning"><i />需验证</span> : null}
          </div>
          <span className="platform-card__meta">{platform.accountCount} 个账号</span>
        </div>
        <div className="platform-card__actions">
          {onConfigure ? (
            <Button
              aria-label={`配置${platform.name}`}
              icon={<SettingOutlined />}
              onClick={onConfigure}
              type="text"
            />
          ) : null}
          {onOpenDirectory ? (
            <Button
              aria-label={`打开${platform.name}文件夹`}
              icon={<FolderOpenOutlined />}
              onClick={onOpenDirectory}
              type="text"
            />
          ) : null}
          {canStart ? (
            <Button
              danger={needsLogin}
              disabled={syncing}
              icon={<SyncOutlined />}
              loading={syncing}
              onClick={onAssistantSync}
              type={needsLogin ? "default" : "primary"}
            >
              {syncing ? "处理中" : actionLabel}
            </Button>
          ) : null}
        </div>
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
    <article className="platform-card platform-card--featured">
      <div className="featured-platform__summary">
        <div className="featured-platform__identity">
          <PlatformLogo platform={platform} />
          <div className="platform-card__content">
            <h3>{platform.name}</h3>
            <div className="featured-platform__hint">
              {platform.accountCount} 个账号 · 任务启动后逐个登录 <ProcessTooltip />
            </div>
          </div>
        </div>
        <div className="featured-platform__tools">
          <Button aria-label="配置微信视频号" icon={<SettingOutlined />} onClick={onConfigure} type="text" />
          <Button aria-label="打开微信视频号文件夹" icon={<FolderOpenOutlined />} onClick={onOpenDirectory} type="text" />
        </div>
        <div className="featured-platform__tasks">
          <Button icon={<SyncOutlined />} disabled={assistantSyncing} loading={assistantSyncing} onClick={onAssistantSync} type="primary">
            {assistantSyncing ? "处理中" : "助手数据"}
          </Button>
          <Button icon={<SyncOutlined />} disabled={promoteSyncing} loading={promoteSyncing} onClick={onPromoteSync}>
            {promoteSyncing ? "处理中" : "加热明细"}
          </Button>
        </div>
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
        className="info-button"
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
      open={open}
      placement="right"
      size="large"
      title={
        <div className="drawer-title">
          <div>微信视频号处理配置</div>
          <p>
            日期范围在每次任务启动时读取；留空下载位置则使用应用默认目录。
          </p>
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
      <div className="settings-grid">
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
        <Alert className="settings-alert" message={configurationError} showIcon type="error" />
      ) : null}

      <div className="directory-setting">
        <label>文件保存位置</label>
        <div className="directory-setting__controls">
          <Input
            readOnly
            value={draft.downloadDirectory ?? ""}
            placeholder="未设置，使用应用默认目录"
            className="directory-setting__input"
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
          <Alert className="directory-setting__error" message={directoryError} showIcon type="error" />
        ) : null}
      </div>
    </Drawer>
  );
}

function KuaishouSettingsDrawer({
  onOpenChange,
  onSave,
  open,
  settings,
}: {
  onOpenChange: (open: boolean) => void
  onSave: (settings: KuaishouSettings) => Promise<void>
  open: boolean
  settings: KuaishouSettings
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
    if (!window.desktop?.kuaishou) {
      setDirectoryError("桌面功能未加载，请重启应用后重试");
      return;
    }

    setDirectoryError(undefined);
    try {
      const directory = await window.desktop.kuaishou.chooseDownloadDirectory();
      if (directory) {
        setDraft((current) => ({ ...current, downloadDirectory: directory }));
      }
    } catch (error) {
      window.desktop.log.error("选择快手文件保存位置失败", {
        error: getErrorMessage(error),
      });
      setDirectoryError(`无法选择文件夹：${getErrorMessage(error)}`);
    }
  }

  async function save() {
    const validationError = validateKuaishouSettings(draft);
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
      open={open}
      placement="right"
      size="large"
      title={
        <div className="drawer-title">
          <div>快手数据处理配置</div>
          <p>使用已登录的快手会话下载 IAA 短剧数据，并自动导入后台。</p>
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
      <div className="settings-grid settings-grid--single">
        <DatePresetFieldset
          customRange={draft.customDateRange}
          label="IAA · 短剧数据"
          name="kuaishou-date-preset"
          onChange={(datePreset) => {
            setConfigurationError(undefined);
            setDraft((current) => ({
              ...current,
              customDateRange:
                datePreset === "custom"
                  ? current.customDateRange ?? createDefaultCustomDateRange()
                  : current.customDateRange,
              datePreset,
            }));
          }}
          onCustomRangeChange={(customDateRange) => {
            setConfigurationError(undefined);
            setDraft((current) => ({ ...current, customDateRange }));
          }}
          value={draft.datePreset}
        />
      </div>

      {configurationError ? (
        <Alert className="settings-alert" message={configurationError} showIcon type="error" />
      ) : null}

      <div className="directory-setting">
        <label>文件保存位置</label>
        <div className="directory-setting__controls">
          <Input
            readOnly
            value={draft.downloadDirectory ?? ""}
            placeholder="未设置，使用应用默认目录"
            className="directory-setting__input"
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
          <Alert className="directory-setting__error" message={directoryError} showIcon type="error" />
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
    <fieldset className="preset-fieldset">
      <legend>{label}</legend>
      <Radio.Group
        className="preset-options"
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value as WeixinChannelsDatePreset)}
      >
        {datePresetOptions.map((option) => (
          <div key={option.value}>
            <Radio className="preset-option" value={option.value}>
              <span className="preset-option__copy">
                <span>{option.label}</span>
                <small>{option.description}</small>
              </span>
            </Radio>
            {option.value === "custom" && value === "custom" && customRange ? (
              <div className="preset-custom-range">
                <DatePicker.RangePicker
                  allowClear={false}
                  format="YYYY-MM-DD"
                  maxDate={dayjs()}
                  value={[
                    dayjs(customRange.startDate),
                    dayjs(customRange.endDate),
                  ]}
                  className="preset-custom-range__picker"
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
    return <span className="platform-logo"><img src={platform.logo} alt="" /></span>;
  }

  return (
    <span className="platform-logo platform-logo--fallback">
      <span />
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
      columns={columns}
      dataSource={records}
      locale={{
        emptyText: (
          <Empty
            image={<DatabaseOutlined />}
            description={
              <span className="table-empty-copy">
                <strong>还没有处理记录</strong>
                <small>完成一次平台同步后，结果会显示在这里</small>
              </span>
            }
          />
        ),
      }}
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

function Footer({
  onOpenUpdater,
  statusText,
  updateState,
}: {
  onOpenUpdater: () => void
  statusText: string
  updateState: UpdateState
}) {
  const updateAvailable = updateState.phase === "available" || updateState.phase === "downloaded";

  return (
    <footer className="app-footer">
      <div className="app-footer__inner">
        <div className="app-footer__meta">
          <span className="app-footer__status">
            <i />
            {statusText}
          </span>
          <Button
            className={updateAvailable ? "version-button version-button--available" : "version-button"}
            icon={updateAvailable ? <DownloadOutlined /> : undefined}
            onClick={onOpenUpdater}
            size="small"
            type="text"
          >
            v{updateState.currentVersion}{updateAvailable ? " · 有新版本" : " · 检查更新"}
          </Button>
        </div>
        <span>数据更新时间：2025-05-20 10:23:50</span>
      </div>
    </footer>
  );
}

function UpdateDrawer({
  onOpenChange,
  onStateChange,
  open,
  sources,
  state,
}: {
  onOpenChange: (open: boolean) => void
  onStateChange: (state: UpdateState) => void
  open: boolean
  sources: UpdateSource[]
  state: UpdateState
}) {
  const busy = state.phase === "checking" || state.phase === "downloading";
  const selectedSource = sources.find((source) => source.id === state.selectedSourceId);

  async function run(action: () => Promise<UpdateState>) {
    try {
      onStateChange(await action());
    } catch (error) {
      onStateChange({
        ...state,
        message: `更新操作失败：${getErrorMessage(error)}`,
        phase: "error",
        progress: 0,
      });
    }
  }

  async function changeSource(sourceId: string) {
    if (!window.desktop?.updater) return;
    await run(() => window.desktop.updater.setSource(sourceId));
  }

  function primaryAction() {
    if (!window.desktop?.updater) return;

    if (state.phase === "available") {
      void run(() => window.desktop.updater.download());
      return;
    }
    if (state.phase === "downloaded") {
      void window.desktop.updater.install();
      return;
    }
    void run(() => window.desktop.updater.check());
  }

  const actionLabel = state.phase === "available"
    ? "下载新版本"
    : state.phase === "downloaded"
      ? "立即重启安装"
      : state.phase === "checking"
        ? "正在检查"
        : state.phase === "downloading"
          ? `正在下载 ${state.progress}%`
          : "检查更新";

  return (
    <Drawer
      destroyOnHidden
      open={open}
      placement="right"
      title={
        <div className="drawer-title">
          <div>版本更新</div>
          <p>检查 GitHub Releases，并在连接失败时自动尝试其他线路。</p>
        </div>
      }
      onClose={() => onOpenChange(false)}
      styles={{ body: { padding: 0 } }}
    >
      <div className="update-summary">
        <div className="update-version-row">
          <div>
            <span className="update-field-label">当前版本</span>
            <strong>v{state.currentVersion}</strong>
          </div>
          {state.availableVersion ? (
            <div>
              <span className="update-field-label">最新版本</span>
              <strong>v{state.availableVersion}</strong>
            </div>
          ) : null}
        </div>

        <div className={`update-status update-status--${state.phase}`} role="status">
          <span className="update-status__dot" />
          <span>{state.message}</span>
        </div>

        {state.phase === "downloading" ? (
          <Progress percent={state.progress} size="small" status="active" />
        ) : null}

        <Button
          block
          disabled={state.phase === "unsupported"}
          icon={state.phase === "available" || state.phase === "downloaded"
            ? <DownloadOutlined />
            : <ReloadOutlined />}
          loading={busy}
          onClick={primaryAction}
          size="large"
          type="primary"
        >
          {actionLabel}
        </Button>
      </div>

      <div className="update-source-setting">
        <label htmlFor="update-source">下载线路</label>
        <Select
          id="update-source"
          disabled={busy}
          onChange={changeSource}
          options={sources.map((source) => ({ label: source.name, value: source.id }))}
          value={state.selectedSourceId}
        />
        <p>{selectedSource?.description ?? "选择优先使用的下载线路。"}</p>
        <span>当前线路不可用时，应用会自动尝试其余线路。</span>
      </div>
    </Drawer>
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

function createKuaishouImportRecord(event: KuaishouSyncEvent): ImportRecord {
  if (event.type === "account-failed") {
    return {
      account: event.accountName ?? "快手账号",
      detail: event.failureReason ?? event.message,
      failed: 1,
      platform: "快手",
      platformLogo: platformLogoUrl("kuaishou.svg"),
      startedAt: formatDateTime(event.timestamp ? new Date(event.timestamp) : new Date()),
      status: "failed",
      success: 0,
      taskName: event.taskName ?? "IAA 短剧数据处理",
      taskType: event.taskType ?? "kuaishou-iaa-mini-series-data",
      total: "-",
      uniqId: event.uniqId,
    };
  }

  const counts = extractImportCounts(event.result);
  const errorDetail = extractImportErrorDetail(event.result);
  const failedCount = counts.failed ?? 0;
  return {
    account: event.accountName ?? "快手账号",
    detail: errorDetail,
    failed: failedCount,
    platform: "快手",
    platformLogo: platformLogoUrl("kuaishou.svg"),
    sourceId: event.sourceId,
    startedAt: formatDateTime(event.timestamp ? new Date(event.timestamp) : new Date()),
    status: failedCount > 0 ? "partial" : "success",
    success: counts.success ?? "-",
    taskName: event.taskName ?? "IAA 短剧数据处理",
    taskType: event.taskType ?? "kuaishou-iaa-mini-series-data",
    total: counts.total ?? "-",
    uniqId: event.uniqId,
  };
}

function extractImportErrorDetail(result: unknown): string | undefined {
  const data = isRecord(result) && isRecord(result.data) ? result.data : result;
  if (!isRecord(data) || !Array.isArray(data.errors) || data.errors.length === 0) {
    return undefined;
  }

  return data.errors
    .slice(0, 3)
    .map((error) => {
      if (!isRecord(error)) {
        return String(error);
      }
      const row = typeof error.rowNumber === "number" ? `第 ${error.rowNumber} 行` : "未知行";
      const column = typeof error.columnName === "string" ? ` ${error.columnName}` : "";
      const message = typeof error.message === "string" ? error.message : "导入失败";
      return `${row}${column}：${message}`;
    })
    .join("；");
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
  const receivedCount = findNumericValue(data, ["receivedCount"]);
  const savedCount = findNumericValue(data, ["savedCount"]);
  const explicitFailed = findNumericValue(data, ["failed", "fail", "failCount", "failureCount", "errorCount"]);

  return {
    failed:
      explicitFailed ??
      (receivedCount !== undefined && savedCount !== undefined
        ? Math.max(0, receivedCount - savedCount)
        : undefined),
    success: findNumericValue(data, ["success", "successCount", "imported", "importedCount", "savedCount"]),
    total: findNumericValue(data, ["total", "totalCount", "count", "rowCount", "receivedCount"]),
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

function validateKuaishouSettings(settings: KuaishouSettings): string | undefined {
  if (settings.datePreset !== "custom") {
    return undefined;
  }

  const range = settings.customDateRange;
  if (!range?.startDate || !range.endDate) {
    return "请选择完整的开始日期和结束日期";
  }
  if (range.endDate < range.startDate) {
    return "结束日期不能早于开始日期";
  }
  if (range.endDate > formatDateInputValue(new Date())) {
    return "结束日期不能晚于今天";
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
